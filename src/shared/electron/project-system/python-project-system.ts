import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ProjectCapabilities,
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '@shared/api/project-system';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { projectInterpreter } from '../provisioning/python-environment';
import { ProjectSystem } from './project-system';
import { logger } from '../logger';

/**
 * The Python project system's root-independent capabilities: an interpreted ecosystem with no compile
 * actions, no build-configuration axis, and no target axis — the definitive case where the ribbon's
 * gated controls simply disappear rather than grey out, taking the whole Solution group with them.
 * Deliberately empty, and not derived per root as Node's are: Python has no conventional build or
 * clean step to run (packaging a distribution is a release action, not a build), so there is nothing
 * for a Build button to dispatch. Debugging is declared: the debugpy adapter is a plugin, so the
 * capability says which adapter debugs Python and the Plugin Manager decides whether it is installed —
 * a capability is what the ecosystem supports, not what happens to be on the machine.
 */
const PYTHON_CAPABILITIES: ProjectCapabilities = {
  actions: [],
  buildConfigurations: [],
  target: null,
  debug: { adapter: 'debugpy' },
};

/**
 * The entry points tried, in order, when a run configuration names no program of its own.
 */
const DEFAULT_ENTRIES: readonly string[] = ['main.py', '__main__.py', 'app.py'];

/**
 * The manifest files that mark a Python project (any of PEP 621 / Poetry, setuptools, or a bare
 * requirements/Pipfile layout).
 */
const MANIFESTS: readonly string[] = [
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
];

/**
 * The directories skipped when listing a project's files: virtual environments, tool caches, and build
 * outputs are never the sources to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'venv',
  'env',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
]);

/**
 * Bounds how many files a project listing returns, so a mis-shaped project (one whose directory is
 * effectively the whole repository) cannot balloon the Solution Explorer.
 */
const MAX_ITEMS: number = 5_000;

/**
 * Reads a Python project's name from a `pyproject.toml`, from `[project].name` (PEP 621) or
 * `[tool.poetry].name` (Poetry). A minimal table-scoped scan — the value is a quoted string on its own
 * line within the owning table — avoids taking a TOML parser dependency for one field.
 * @param toml The `pyproject.toml` content, or null when absent.
 * @returns Returns the name, or null when neither table declares one.
 */
export function parsePyprojectName(toml: string | null): string | null {
  if (toml === null) {
    return null;
  }
  return tableName(toml, '[project]') ?? tableName(toml, '[tool.poetry]');
}

/**
 * Reads the `name` key from the given TOML table, when present.
 * @param toml The TOML content.
 * @param header The table header to read within (for example `[project]`).
 * @returns Returns the name, or null when the table or its name key is absent.
 */
function tableName(toml: string, header: string): string | null {
  const lines: readonly string[] = toml.split('\n');
  const start: number = lines.findIndex((line: string): boolean => line.trim() === header);
  if (start === -1) {
    return null;
  }
  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index].trim();
    // A new table header ends the current table's scope.
    if (line.startsWith('[')) {
      return null;
    }
    const match: RegExpExecArray | null = /^name\s*=\s*['"]([^'"]+)['"]/.exec(line);
    if (match !== null) {
      return match[1];
    }
  }
  return null;
}

/**
 * Reads a Python project's name from a `setup.py`, from the `name='...'` keyword argument of its
 * `setup(...)` call.
 * @param setupPy The `setup.py` content, or null when absent.
 * @returns Returns the name, or null when it is not a simple string literal.
 */
export function parseSetupPyName(setupPy: string | null): string | null {
  if (setupPy === null) {
    return null;
  }
  const match: RegExpExecArray | null = /\bname\s*=\s*['"]([^'"]+)['"]/.exec(setupPy);
  return match === null ? null : match[1];
}

/**
 * Reads a Python project's name from a `setup.cfg`, from the `name = ...` key of its `[metadata]`
 * section.
 * @param setupCfg The `setup.cfg` content, or null when absent.
 * @returns Returns the name, or null when the metadata name is absent.
 */
export function parseSetupCfgName(setupCfg: string | null): string | null {
  if (setupCfg === null) {
    return null;
  }
  const lines: readonly string[] = setupCfg.split('\n');
  const start: number = lines.findIndex((line: string): boolean => line.trim() === '[metadata]');
  if (start === -1) {
    return null;
  }
  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index].trim();
    if (line.startsWith('[')) {
      return null;
    }
    const match: RegExpExecArray | null = /^name\s*=\s*(.+)$/.exec(line);
    if (match !== null) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Models a Python project: a single root package identified by its manifest (PEP 621 / Poetry
 * `pyproject.toml`, setuptools `setup.py`/`setup.cfg`, or a bare `requirements.txt`/`Pipfile` layout).
 * Its files are listed straight from the root, skipping virtual-environment, cache, and build folders.
 * Deliberately language-server-agnostic, like the other providers; the workspace view prestarts Pyright
 * for `python` models. As an interpreted ecosystem it declares no build actions and no target axis, so
 * the ribbon's gated controls disappear entirely — the acceptance test for the capability abstraction.
 */
export class PythonProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'python';

  /**
   * Gets the root-independent capabilities this project system declares.
   */
  public readonly capabilities: ProjectCapabilities = PYTHON_CAPABILITIES;

  /**
   * Determines whether the root holds a Python project (any recognised manifest at the root).
   * @param root The absolute workspace root.
   * @returns Returns true when a Python manifest is present.
   */
  public async detect(root: string): Promise<boolean> {
    return (await this.manifest(root)) !== null;
  }

  /**
   * Determines whether this provider owns a project file (a recognised Python manifest).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a Python manifest.
   */
  public ownsProject(projectPath: string): boolean {
    return MANIFESTS.includes(path.basename(projectPath));
  }

  /**
   * Builds the Python project model: the single root package, named from its manifest.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root holds no Python manifest.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    logger.trace('PythonProjectSystem', `Loading the Python model for '${root}'.`);
    const manifestPath: string | null = await this.manifest(root);
    if (manifestPath === null) {
      logger.debug('PythonProjectSystem', `No Python manifest found at '${root}'.`);
      return null;
    }
    const name: string = (await this.projectName(root)) ?? path.basename(root);
    logger.info('PythonProjectSystem', `Loaded Python project '${name}' from '${manifestPath}'.`);
    const tree: readonly ProjectNode[] = [{ type: 'project', name, path: manifestPath }];
    return {
      kind: this.kind,
      root,
      solution: null,
      projects: this.flatten(tree),
      tree,
      capabilities: this.capabilities,
    };
  }

  /**
   * Lists the project's files straight from the root directory, skipping virtual-environment, cache,
   * and build folders.
   * @param projectPath The absolute path of the project manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  /**
   * Resolves a run configuration into a Python launch target: the script to run, and the interpreter to
   * run it under.
   *
   * The interpreter matters as much as the script. debugpy runs from Studio's own environment, so
   * without being told otherwise it would run the debuggee there too and none of the project's
   * dependencies would import. The project's own virtual environment wins, falling back to a detected
   * system interpreter.
   * @param configuration The run configuration to debug.
   * @param root The workspace root.
   * @returns Returns the launch target, or a reason it could not be resolved.
   */
  public async resolveDebugTarget(
    configuration: RunConfiguration,
    root: string,
  ): Promise<DebugResolveResult> {
    const named: string | undefined =
      configuration.program !== undefined && configuration.program.length > 0
        ? configuration.program
        : undefined;
    const program: string | null =
      named !== undefined ? path.resolve(root, named) : await this.defaultEntry(root);
    if (program === null) {
      return {
        target: null,
        error: `No Python entry point found. Set one on the run configuration, or add ${DEFAULT_ENTRIES.join(', ')}.`,
      };
    }
    // Confine the launch to the open workspace: the program originates from renderer-supplied
    // configuration, so a hostile one must not point the debugger outside the root.
    if (program !== root && !program.startsWith(path.resolve(root) + path.sep)) {
      logger.warn(
        'PythonProjectSystem',
        `Refused a debug program outside the workspace: '${program}' not under '${root}'.`,
      );
      return { target: null, error: 'The program to debug must be inside the workspace.' };
    }
    const interpreter: string | null = await projectInterpreter(root);
    if (interpreter === null) {
      return { target: null, error: 'No Python interpreter found to run the program.' };
    }
    logger.debug('PythonProjectSystem', `Debugging ${program} with ${interpreter}`);
    return {
      target: { program, cwd: root, launchExtras: { python: interpreter } },
      error: null,
    };
  }

  /**
   * Finds a conventional entry point in the project root.
   * @param root The workspace root.
   * @returns Returns the absolute path of the entry point, or null when none is present.
   */
  private async defaultEntry(root: string): Promise<string | null> {
    for (const name of DEFAULT_ENTRIES) {
      const candidate: string = path.join(root, name);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Not this one; try the next.
      }
    }
    return null;
  }

  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    const tree: readonly ProjectItemNode[] | null = await this.listDirectory(directory, budget);
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Resolves the project's display name from its manifests, preferring `pyproject.toml`, then
   * `setup.py`, then `setup.cfg`.
   * @param root The absolute workspace root.
   * @returns Returns the name, or null when no manifest declares one.
   */
  private async projectName(root: string): Promise<string | null> {
    return (
      parsePyprojectName(await this.readFile(path.join(root, 'pyproject.toml'))) ??
      parseSetupPyName(await this.readFile(path.join(root, 'setup.py'))) ??
      parseSetupCfgName(await this.readFile(path.join(root, 'setup.cfg')))
    );
  }

  /**
   * Finds the first recognised Python manifest present at the root.
   * @param root The absolute workspace root.
   * @returns Returns the absolute manifest path, or null when none is present.
   */
  private async manifest(root: string): Promise<string | null> {
    for (const name of MANIFESTS) {
      const full: string = path.join(root, name);
      try {
        if ((await fs.stat(full)).isFile()) {
          return full;
        }
      } catch {
        // Try the next manifest.
      }
    }
    return null;
  }

  /**
   * Lists one directory level as item nodes, recursing into subdirectories.
   * @param directory The directory to list.
   * @param budget The remaining file budget, decremented as files are added.
   * @returns Returns the nodes, or null when the directory cannot be read.
   */
  private async listDirectory(
    directory: string,
    budget: { remaining: number },
  ): Promise<readonly ProjectItemNode[] | null> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }
    const directories: Dirent[] = entries
      .filter((entry: Dirent): boolean => entry.isDirectory() && !this.isSkipped(entry.name))
      .sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name));
    const files: Dirent[] = entries
      .filter((entry: Dirent): boolean => entry.isFile())
      .sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name));
    const nodes: ProjectItemNode[] = [];
    for (const child of directories) {
      const full: string = path.join(directory, child.name);
      const children: readonly ProjectItemNode[] | null = await this.listDirectory(full, budget);
      if (children !== null && children.length > 0) {
        nodes.push({ type: 'folder', name: child.name, path: full, children });
      }
    }
    for (const file of files) {
      if (budget.remaining <= 0) {
        break;
      }
      budget.remaining -= 1;
      nodes.push({ type: 'file', name: file.name, path: path.join(directory, file.name) });
    }
    return nodes;
  }

  /**
   * Reads a file's UTF-8 content.
   * @param filePath The absolute file path.
   * @returns Returns the content, or null when the file cannot be read.
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Determines whether a directory is skipped when listing the project's files.
   * @param name The directory name.
   * @returns Returns true when the directory should be skipped.
   */
  private isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
  }

  /**
   * Flattens a tree into its projects, in tree order.
   * @param tree The tree to flatten.
   * @returns Returns the projects.
   */
  private flatten(tree: readonly ProjectNode[]): readonly ProjectEntry[] {
    const projects: ProjectEntry[] = [];
    for (const node of tree) {
      if (node.type === 'project') {
        projects.push({ name: node.name, path: node.path });
      }
    }
    return projects;
  }
}
