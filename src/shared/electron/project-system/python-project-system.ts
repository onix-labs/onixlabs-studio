import { Dirent, Stats } from 'node:fs';
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
import { buildItemTree, EvaluatedItem } from './item-tree';
import { ProjectSystem } from './project-system';
import { declaredPackagePaths, declaresBuildSystem } from './pyproject-layout';
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
  // This ecosystem has no solution folders, so there is nothing to rename.
  renamesSolutionFolders: false,
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
 * The manifest that declares what a project packages.
 */
const PYPROJECT: string = 'pyproject.toml';

/**
 * The folders that hold a project's tests, which it does not declare because it does not ship them.
 */
const TEST_DIRECTORIES: readonly string[] = ['tests', 'test'];

/**
 * Matches the root files listed beside the declared packages: Python sources (a `main.py` is not
 * packaged, but it is what the project runs, and a source can never crowd anything out), and the files
 * that pin what is installed.
 */
const ROOT_FILE_PATTERN: RegExp =
  /\.py$|^(requirements.*\.txt|Pipfile\.lock|poetry\.lock|pdm\.lock|uv\.lock)$/;

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
 * Its contents are the packages and modules its `pyproject.toml` declares, or its files listed straight
 * from the root, skipping virtual-environment, cache, and build folders, when it declares none.
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

  /**
   * Loads what the project is made of (#899): the packages and modules its `pyproject.toml` declares,
   * its tests, its root Python files, and its manifests, so outputs and assets that share the tree stay
   * out of the Solution Explorer; the File Explorer shows everything. The manifest is only read: a
   * `setup.py` is never run and no build backend is called, so what a backend would have to compute
   * counts as undeclared. A project declaring nothing that exists has its files listed straight from
   * the root instead, skipping virtual-environment, cache, and build folders.
   * @param projectPath The absolute path of the project manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const tree: readonly ProjectItemNode[] | null =
      (await this.declaredTree(projectPath, directory)) ??
      (await this.listDirectory(directory, { remaining: MAX_ITEMS }));
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Builds the project's contents from what its `pyproject.toml` declares. The declared packages are
   * listed in full, data files included, since a package ships what sits in it.
   * @param projectPath The absolute path of the project manifest.
   * @param directory The project's directory.
   * @returns Returns the contents, or null when nothing declared exists.
   */
  private async declaredTree(
    projectPath: string,
    directory: string,
  ): Promise<readonly ProjectItemNode[] | null> {
    const toml: string | null = await this.readFile(path.join(directory, PYPROJECT));
    if (toml === null) {
      return null;
    }
    const declared: readonly string[] = declaredPackagePaths(toml);
    const candidates: readonly string[] =
      declared.length > 0 || !declaresBuildSystem(toml) ? declared : ['src'];
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    const sources: string[] = [];
    for (const candidate of candidates) {
      sources.push(...(await this.declaredFiles(directory, candidate, budget)));
    }
    if (sources.length === 0) {
      return null;
    }
    const tests: string[] = [];
    for (const name of TEST_DIRECTORIES) {
      tests.push(...(await this.declaredFiles(directory, name, budget)));
    }
    const files: readonly string[] = [...(await this.rootFiles(directory)), ...sources, ...tests];
    logger.debug(
      'PythonProjectSystem',
      `Listed ${sources.length} declared file(s) for '${projectPath}' from its pyproject.toml.`,
    );
    return buildItemTree(
      projectPath,
      files.map((file: string): EvaluatedItem => ({
        identity: path.relative(directory, file),
        link: '',
      })),
    );
  }

  /**
   * Lists what a declared path holds. The path comes from a file in the workspace, so one that leaves
   * the project, or is the project itself, holds nothing.
   * @param directory The project's directory.
   * @param declared The declared path, relative to the project.
   * @param budget The remaining file budget.
   * @returns Returns the absolute paths of its files.
   */
  private async declaredFiles(
    directory: string,
    declared: string,
    budget: { remaining: number },
  ): Promise<readonly string[]> {
    const full: string = path.resolve(directory, declared);
    const relative: string = path.relative(directory, full);
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
      return [];
    }
    let kind: Stats;
    try {
      // Not followed, as the listing does not follow one: a link could lead out of the project.
      kind = await fs.lstat(full);
    } catch {
      return [];
    }
    if (kind.isFile()) {
      return [full];
    }
    return kind.isDirectory() ? this.filesOf((await this.listDirectory(full, budget)) ?? []) : [];
  }

  /**
   * Finds the files listed from the project's root: its manifests, lock files and Python sources.
   * @param directory The project's directory.
   * @returns Returns the absolute paths.
   */
  private async rootFiles(directory: string): Promise<readonly string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter(
        (entry: Dirent): boolean =>
          entry.isFile() && (MANIFESTS.includes(entry.name) || ROOT_FILE_PATTERN.test(entry.name)),
      )
      .map((entry: Dirent): string => path.join(directory, entry.name));
  }

  /**
   * Flattens a listing into its files.
   * @param nodes The listing.
   * @returns Returns the absolute paths.
   */
  private filesOf(nodes: readonly ProjectItemNode[]): readonly string[] {
    return nodes.flatMap((node: ProjectItemNode): readonly string[] =>
      node.type === 'file' ? [node.path] : this.filesOf(node.children),
    );
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
