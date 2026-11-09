import { execFile } from 'node:child_process';
import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  ProjectCapabilities,
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '@shared/api/project-system';
import {
  cargoMetadataArguments,
  crateSourceDirectories,
  parseCargoTargetSources,
} from './cargo-metadata';
import { buildItemTree, EvaluatedItem } from './item-tree';
import {
  CargoDebugBuild,
  cargoBuildErrors,
  cargoDebugBuild,
  builtPrograms,
} from './cargo-debug-target';
import type { DebugResolveResult } from '@shared/api/debug-channels';
import type { RunConfiguration } from '@shared/api/studio';
import { ProjectSystem } from './project-system';
import { logger } from '../logger';

/**
 * The Rust project system's root-independent capabilities: the Build/Clean/Rebuild actions Cargo
 * supports, its dev/release profiles as build configurations, a target-triple axis, and CodeLLDB as
 * its debugger (#1210), installed from the Plugin Manager like netcoredbg for .NET.
 */
const RUST_CAPABILITIES: ProjectCapabilities = {
  actions: ['build', 'clean', 'rebuild'],
  buildConfigurations: [
    { id: 'dev', name: 'Dev' },
    { id: 'release', name: 'Release' },
  ],
  target: {
    kind: 'target-triple',
    label: 'Target',
    options: [
      { id: 'aarch64-apple-darwin', name: 'macOS (Apple Silicon)' },
      { id: 'x86_64-apple-darwin', name: 'macOS (Intel)' },
      { id: 'x86_64-unknown-linux-gnu', name: 'Linux (x64)' },
      { id: 'x86_64-pc-windows-msvc', name: 'Windows (x64)' },
      { id: 'wasm32-unknown-unknown', name: 'WebAssembly' },
    ],
  },
  debug: { adapter: 'codelldb' },
  // This ecosystem has no solution folders, so there is nothing to rename.
  renamesSolutionFolders: false,
};

/**
 * The Cargo manifest that marks a Rust project root.
 */
const MANIFEST: string = 'Cargo.toml';

/**
 * The directories skipped when listing a crate's files: the build output and dependency vendor
 * directories are never the sources to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>(['target', 'node_modules']);

/**
 * Bounds how many files a crate listing returns, so a mis-shaped crate cannot balloon the Solution
 * Explorer.
 */
const MAX_ITEMS: number = 5_000;

/**
 * The lock file listed beside a crate's manifest when it has one.
 */
const LOCK_FILE: string = 'Cargo.lock';

/**
 * Bounds how long `cargo metadata` may take, so a wedged toolchain cannot hold the Solution Explorer. It
 * reads manifests and nothing else, so it answers in well under a second on any real workspace.
 */
const METADATA_TIMEOUT_MS: number = 30_000;

/**
 * The maximum bytes of `cargo metadata` output buffered, generous so a large workspace is not truncated.
 */
const METADATA_BUFFER: number = 64 * 1024 * 1024;

/**
 * Bounds how long the build a debug session waits on may take (#1210). A first build of a large crate
 * graph takes minutes; past this the session gives up rather than hang.
 */
const DEBUG_BUILD_TIMEOUT_MS: number = 15 * 60_000;

/**
 * Runs a child process and resolves with its standard output.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    timeout: number;
    killSignal: NodeJS.Signals;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * Reads a crate's name from the `name` key of a Cargo manifest's `[package]` table.
 * @param toml The `Cargo.toml` content, or null when absent.
 * @returns Returns the crate name, or null when the package table declares none (for example a virtual
 * workspace root).
 */
export function parseCargoPackageName(toml: string | null): string | null {
  if (toml === null) {
    return null;
  }
  const lines: readonly string[] = toml.split('\n');
  const start: number = lines.findIndex((line: string): boolean => line.trim() === '[package]');
  if (start === -1) {
    return null;
  }
  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index].trim();
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
 * Extracts the workspace member patterns from a Cargo manifest's `[workspace].members` array (which may
 * span multiple lines). Each entry is a path relative to the root, possibly ending in a `*` wildcard
 * (`crates/*`).
 * @param toml The `Cargo.toml` content, or null when absent.
 * @returns Returns the member patterns, in declaration order.
 */
export function parseCargoWorkspaceMembers(toml: string | null): readonly string[] {
  if (toml === null) {
    return [];
  }
  const block: RegExpExecArray | null = /^\s*members\s*=\s*\[([\s\S]*?)\]/m.exec(toml);
  if (block === null) {
    return [];
  }
  const members: string[] = [];
  for (const quoted of block[1].matchAll(/['"]([^'"]+)['"]/g)) {
    if (quoted[1].length > 0) {
      members.push(quoted[1]);
    }
  }
  return members;
}

/**
 * Models a Rust workspace built by Cargo: the root crate, plus — when the manifest declares a
 * `[workspace]` — each member crate expanded from its `members` patterns (literal paths and single-level
 * `crates/*` wildcards). A crate's contents are what `cargo metadata` says its targets are made of, or
 * its files listed straight from its directory, skipping the `target` output, when that cannot be read.
 * Deliberately language-server-agnostic, like the other providers; the workspace view prestarts
 * rust-analyzer for `rust` models.
 */
export class RustProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'rust';

  /**
   * Gets the root-independent capabilities this project system declares.
   */
  public readonly capabilities: ProjectCapabilities = RUST_CAPABILITIES;

  /**
   * Determines whether the root holds a Cargo project (a `Cargo.toml` at the root).
   * @param root The absolute workspace root.
   * @returns Returns true when a Cargo manifest is present.
   */
  public async detect(root: string): Promise<boolean> {
    return this.exists(path.join(root, MANIFEST));
  }

  /**
   * Determines whether this provider owns a project file (a `Cargo.toml`).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a Cargo manifest.
   */
  public ownsProject(projectPath: string): boolean {
    return path.basename(projectPath) === MANIFEST;
  }

  /**
   * Builds the Rust project model: the root crate alone, or — for a workspace — the root manifest as
   * the solution with each expanded member crate as a project.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root has no Cargo manifest.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    logger.trace('RustProjectSystem', `Loading the Rust model for '${root}'.`);
    const manifestPath: string = path.join(root, MANIFEST);
    const toml: string | null = await this.readFile(manifestPath);
    if (toml === null) {
      logger.debug('RustProjectSystem', `No readable 'Cargo.toml' at '${root}'.`);
      return null;
    }
    const rootName: string = parseCargoPackageName(toml) ?? path.basename(root);
    const memberDirs: readonly string[] = await this.expandMembers(
      root,
      parseCargoWorkspaceMembers(toml),
    );
    if (memberDirs.length === 0) {
      const tree: readonly ProjectNode[] = [
        { type: 'project', name: rootName, path: manifestPath },
      ];
      return this.model(root, tree, null);
    }
    const members: ProjectNode[] = [];
    for (const directory of memberDirs) {
      const memberManifest: string = path.join(directory, MANIFEST);
      const memberToml: string | null = await this.readFile(memberManifest);
      if (memberToml !== null) {
        members.push({
          type: 'project',
          name: parseCargoPackageName(memberToml) ?? path.basename(directory),
          path: memberManifest,
        });
      }
    }
    members.sort((a: ProjectNode, b: ProjectNode): number => a.name.localeCompare(b.name));
    // A virtual workspace root (no [package]) contributes no crate of its own; a root that is both a
    // package and a workspace contributes itself too.
    const rootIsCrate: boolean = parseCargoPackageName(toml) !== null;
    const tree: readonly ProjectNode[] = rootIsCrate
      ? [{ type: 'project', name: rootName, path: manifestPath }, ...members]
      : members;
    return this.model(root, tree, { name: rootName, path: manifestPath });
  }

  /**
   * Loads what a crate's build is made of (#899): its manifest, its targets' source files, and the
   * directories those sit in, so outputs, assets and other members that share the tree stay out of the
   * Solution Explorer; the File Explorer shows everything. When Cargo is missing or cannot answer, the
   * crate's files are listed from its directory instead, skipping the build-output folder.
   * @param projectPath The absolute path of the crate manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const tree: readonly ProjectItemNode[] | null =
      (await this.targetTree(projectPath)) ??
      (await this.listDirectory(path.dirname(projectPath), { remaining: MAX_ITEMS }));
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Builds a crate's contents from its targets. The targets' own source files are placed first, so the
   * budget a large folder of fixtures spends can never push out a crate's entry points. The targets
   * are not shown as groups, as a CMake project's are: a module under `src` belongs to whichever target
   * declares it, which only the compiler knows, and a file listed under two groups would be two rows
   * with one identity.
   * @param projectPath The absolute path of the crate manifest.
   * @returns Returns the contents, or null when Cargo has no answer or the crate no targets.
   */
  private async targetTree(projectPath: string): Promise<readonly ProjectItemNode[] | null> {
    let manifestPath: string;
    try {
      // Cargo answers with resolved paths, so the manifest is resolved first to find it in the answer.
      manifestPath = await fs.realpath(projectPath);
    } catch {
      return null;
    }
    const sources: readonly string[] | null = await this.targetSources(manifestPath);
    if (sources === null || sources.length === 0) {
      return null;
    }
    const crateDirectory: string = path.dirname(manifestPath);
    const files: string[] = [manifestPath, ...sources];
    if (await this.exists(path.join(crateDirectory, LOCK_FILE))) {
      files.push(path.join(crateDirectory, LOCK_FILE));
    }
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    for (const directory of crateSourceDirectories(crateDirectory, sources)) {
      files.push(...this.filesOf((await this.listDirectory(directory, budget)) ?? []));
    }
    logger.debug(
      'RustProjectSystem',
      `Listed ${sources.length} Cargo target(s) for '${projectPath}' from \`cargo metadata\`.`,
    );
    return buildItemTree(
      projectPath,
      files.map((file: string): EvaluatedItem => ({
        identity: path.relative(crateDirectory, file),
        link: '',
      })),
    );
  }

  /**
   * Asks Cargo for a crate's targets, trying each `cargo` in turn. Run from outside the workspace, with
   * the manifest named: `cargo` is usually rustup's proxy, which would otherwise take the toolchain
   * from a `rust-toolchain.toml` in the workspace, and that can name a folder of the workspace's own
   * to run `cargo` from. Cargo's `.cargo/config.toml` is found the same way and is left unread too.
   * @param manifestPath The absolute path of the crate manifest.
   * @returns Returns the targets' source files, or null when no Cargo could answer.
   */
  private async targetSources(manifestPath: string): Promise<readonly string[] | null> {
    for (const cargo of this.cargoExecutables()) {
      try {
        const { stdout }: { stdout: string } = await execFileAsync(
          cargo,
          cargoMetadataArguments(manifestPath),
          {
            cwd: tmpdir(),
            // Rustup must not download a toolchain from a scan.
            env: { ...process.env, RUSTUP_AUTO_INSTALL: '0' },
            maxBuffer: METADATA_BUFFER,
            timeout: METADATA_TIMEOUT_MS,
            killSignal: 'SIGKILL',
            windowsHide: true,
          },
        );
        return parseCargoTargetSources(stdout, manifestPath);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        logger.warn(
          'RustProjectSystem',
          `\`cargo metadata\` failed for '${manifestPath}'; listing the files instead.`,
          error,
        );
        return null;
      }
    }
    logger.debug('RustProjectSystem', 'No `cargo` to read the crate with; listing the files.');
    return null;
  }

  /**
   * Resolves a run configuration into what CodeLLDB launches (#1210). A Cargo command — the one a Run or
   * Debug lens gives, or a run configuration's — is built without being run (`cargo test --no-run`,
   * `cargo run` as `cargo build`), and the program it produced is launched with the arguments that came
   * after `--`. The build is the same one Run would do, run in the same folder, so it runs the same
   * build scripts. A configuration that runs a program directly launches that program.
   * @param configuration The run configuration being launched under the debugger.
   * @param root The absolute workspace root, which the build must run within.
   * @returns Returns the launch target, or a reason it could not be resolved.
   */
  public async resolveDebugTarget(
    configuration: RunConfiguration,
    root: string,
  ): Promise<DebugResolveResult> {
    const cwd: string = path.resolve(root, configuration.cwd ?? '.');
    // The configuration arrives from the renderer, so a hostile one must not run Cargo elsewhere.
    if (cwd !== path.resolve(root) && !cwd.startsWith(path.resolve(root) + path.sep)) {
      logger.warn('RustProjectSystem', `Refused a debug build outside the workspace: '${cwd}'.`);
      return { target: null, error: 'The configuration runs outside the workspace.' };
    }
    const env: Readonly<Record<string, string>> = configuration.env ?? {};
    // CodeLLDB reads Rust's strings, vectors and enums as Rust, rather than as the C they compile to.
    const launchExtras: Readonly<Record<string, unknown>> = { sourceLanguages: ['rust'] };
    const named: string | undefined = configuration.program;
    if (named === undefined) {
      return { target: null, error: 'The configuration names no program to debug.' };
    }
    if (path.basename(named, '.exe') !== 'cargo') {
      return {
        target: {
          program: path.resolve(cwd, named),
          args: configuration.args,
          cwd,
          env,
          launchExtras,
        },
        error: null,
      };
    }
    const build: CargoDebugBuild | null = cargoDebugBuild(configuration.args ?? []);
    if (build === null) {
      return {
        target: null,
        error: 'Only `cargo run`, `cargo test` and `cargo bench` build something to debug.',
      };
    }
    for (const cargo of this.cargoExecutables()) {
      let stdout: string;
      try {
        logger.debug(
          'RustProjectSystem',
          `Building for the debugger: cargo ${build.build.join(' ')}`,
        );
        ({ stdout } = await execFileAsync(cargo, build.build, {
          cwd,
          env: { ...process.env, ...env },
          maxBuffer: METADATA_BUFFER,
          timeout: DEBUG_BUILD_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          windowsHide: true,
        }));
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        const output: string = (error as { stdout?: unknown }).stdout as string;
        const errors: string = typeof output === 'string' ? cargoBuildErrors(output) : '';
        logger.warn('RustProjectSystem', `The debug build failed in '${cwd}'.`, error);
        return {
          target: null,
          error: errors.length > 0 ? `Build failed.\n${errors}` : 'Build failed.',
        };
      }
      const programs: readonly string[] = builtPrograms(stdout, build.test);
      if (programs.length > 1) {
        return {
          target: null,
          error:
            'The build produced more than one program. Debug a single test, or name a --bin, --lib or --test.',
        };
      }
      const program: string | undefined = programs[0];
      if (program === undefined) {
        return { target: null, error: 'The build produced no program to debug.' };
      }
      logger.info('RustProjectSystem', `Resolved a debug target: '${program}'.`);
      return {
        target: { program, args: build.executableArgs, cwd, env, launchExtras },
        error: null,
      };
    }
    return { target: null, error: 'The `cargo` command could not be found on this machine.' };
  }

  /**
   * Gets the `cargo` executables to try: the one on the `PATH`, then rustup's own install location,
   * which a shell profile adds to the `PATH` and a GUI launch may not have.
   * @returns Returns the executables, in order.
   */
  private cargoExecutables(): readonly string[] {
    const home: string = process.env['CARGO_HOME'] ?? path.join(homedir(), '.cargo');
    const exe: string = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
    return ['cargo', path.join(home, 'bin', exe)];
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
   * Assembles a project model from its crate tree and optional workspace solution.
   * @param root The absolute workspace root.
   * @param tree The crate tree.
   * @param solution The workspace solution, or null for a single-crate root.
   * @returns Returns the model.
   */
  private model(
    root: string,
    tree: readonly ProjectNode[],
    solution: { name: string; path: string } | null,
  ): ProjectModel {
    const projects: readonly ProjectEntry[] = this.flatten(tree);
    logger.info(
      'RustProjectSystem',
      `Loaded Rust ${solution === null ? 'crate' : 'workspace'} at '${root}' with ${projects.length} crate(s).`,
    );
    return {
      kind: this.kind,
      root,
      solution,
      projects,
      tree,
      capabilities: this.capabilities,
    };
  }

  /**
   * Expands Cargo workspace member patterns into crate directories, supporting literal paths and the
   * single-level `crates/*` wildcard.
   * @param root The absolute workspace root.
   * @param patterns The declared member patterns.
   * @returns Returns the absolute crate directories.
   */
  private async expandMembers(
    root: string,
    patterns: readonly string[],
  ): Promise<readonly string[]> {
    const directories: string[] = [];
    for (const pattern of patterns) {
      if (!pattern.endsWith('/*')) {
        directories.push(path.join(root, pattern));
        continue;
      }
      const base: string = path.join(root, pattern.slice(0, -2));
      try {
        const entries: Dirent[] = await fs.readdir(base, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            directories.push(path.join(base, entry.name));
          }
        }
      } catch {
        // A member glob with no matching directory contributes nothing.
      }
    }
    return directories;
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
   * Determines whether a file exists.
   * @param filePath The absolute file path.
   * @returns Returns true when the file exists and is a regular file.
   */
  private async exists(filePath: string): Promise<boolean> {
    try {
      return (await fs.stat(filePath)).isFile();
    } catch {
      return false;
    }
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
   * Determines whether a directory is skipped when listing a crate's files.
   * @param name The directory name.
   * @returns Returns true when the directory should be skipped.
   */
  private isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
  }

  /**
   * Flattens a tree into its crates, in tree order.
   * @param tree The tree to flatten.
   * @returns Returns the crates.
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
