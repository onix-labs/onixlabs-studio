// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.
//
// Which tool, by what the project keeps:
// - uv (a `uv.lock`, or a `[tool.uv]` table): `uv add`, `uv remove`, `uv sync`;
// - Poetry (a `poetry.lock`, or a `[tool.poetry]` table): `poetry add`, `poetry remove`,
//   `poetry install`;
// - Pipenv (a `Pipfile`): `pipenv install`, `pipenv uninstall`, `pipenv sync`;
// - a requirements file: restore only, `python -m pip install -r <file>`, with the project's own
//   virtual environment's interpreter when it has one. pip has no command that edits a requirements
//   file, so adding, updating and removing are refused in words saying so.
// A `pyproject.toml` with none of those, a `setup.cfg` and a `setup.py` say nothing of which tool
// manages them, and the plugin will not guess: a write is refused, saying why.
//
// An update keeps a package where it is declared — an extra stays an extra, a group stays a group —
// by naming that place to the tool.

import * as path from 'node:path';
import { Placement } from './manifests';
import { PackageCommand } from './protocol';
import { isPackageName } from './requirements';
import { isValidVersion } from './versions';

/**
 * Names the tools a Python project can be managed by.
 */
export type PythonTool = 'uv' | 'poetry' | 'pipenv' | 'pip';

/**
 * What a command is built for: the project, its tool, and the interpreter of its environment.
 */
export interface CommandTarget {
  /**
   * Gets the absolute manifest path.
   */
  readonly manifestPath: string;

  /**
   * Gets the tool that manages the project, or null when nothing says which does.
   */
  readonly tool: PythonTool | null;

  /**
   * Gets whether the project has the lockfile its tool keeps.
   */
  readonly locked: boolean;

  /**
   * Gets the absolute path of the project's virtual environment, or null.
   */
  readonly venv: string | null;
}

/**
 * Matches an extra's or a group's name, as PEP 685 and PEP 735 allow them: it is passed as an
 * argument, so it must not be read as an option.
 */
const GROUP_NAME: RegExp = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Matches the characters a version may hold; with {@link isValidVersion}, a version starts with a
 * digit, so it cannot be read as an option.
 */
const VERSION_CHARACTERS: RegExp = /^\d[0-9A-Za-z.!+_-]*$/;

/**
 * Builds the command that adds a package to a project, or moves one it declares to another version.
 * @param target The project.
 * @param name The package name.
 * @param version The version, or null for the latest.
 * @param placement Where the package is declared, or where a new one goes.
 * @param update Whether the package is already declared.
 * @returns Returns the command.
 * @throws When the name or version could be read as something else, or the project's tool cannot.
 */
export function addCommand(
  target: CommandTarget,
  name: string,
  version: string | null,
  placement: Placement,
  update: boolean,
): PackageCommand {
  checkName(name);
  checkVersion(version);
  const title: string = `${update ? 'Update' : 'Install'} ${name}`;
  const exact: string = version === null ? name : `${name}==${version}`;
  switch (target.tool) {
    case 'uv':
      return command('uv', ['add', ...uvPlacement(placement), exact], target, title);
    case 'poetry': {
      if (placement.kind === 'optional') {
        throw new Error(
          `${name} is an optional dependency, which each Poetry version marks differently. Change it in ${path.basename(target.manifestPath)}, then restore.`,
        );
      }
      // `@latest` is how Poetry is told to move a declared package to its newest release.
      const spec: string = version === null && update ? `${name}@latest` : exact;
      return command('poetry', ['add', ...groupFlag(placement), spec], target, title);
    }
    case 'pipenv':
      return command(
        'pipenv',
        ['install', ...(placement.kind === 'group' ? ['--dev'] : []), exact],
        target,
        title,
      );
    case 'pip':
      throw new Error(
        `pip has no command that changes a requirements file. Edit ${path.basename(target.manifestPath)}, then restore it.`,
      );
    default:
      throw new Error(unmanaged(target));
  }
}

/**
 * Builds the command that removes a package from a project.
 * @param target The project.
 * @param name The package name.
 * @param placement Where the package is declared.
 * @returns Returns the command.
 * @throws When the name could be read as something else, or the project's tool cannot.
 */
export function removeCommand(
  target: CommandTarget,
  name: string,
  placement: Placement,
): PackageCommand {
  checkName(name);
  const title: string = `Remove ${name}`;
  switch (target.tool) {
    case 'uv':
      return command('uv', ['remove', ...uvPlacement(placement), name], target, title);
    case 'poetry':
      return command('poetry', ['remove', ...groupFlag(placement), name], target, title);
    case 'pipenv':
      return command('pipenv', ['uninstall', name], target, title);
    case 'pip':
      throw new Error(
        `pip has no command that changes a requirements file. Remove ${name} from ${path.basename(target.manifestPath)}.`,
      );
    default:
      throw new Error(unmanaged(target));
  }
}

/**
 * Builds the command that installs what a project declares, its development packages with them.
 * @param target The project.
 * @returns Returns the command.
 * @throws When nothing says which tool manages the project.
 */
export function restoreCommand(target: CommandTarget): PackageCommand {
  const title: string = 'Restore packages';
  switch (target.tool) {
    case 'uv':
      return command('uv', ['sync'], target, title);
    case 'poetry':
      return command('poetry', ['install'], target, title);
    case 'pipenv':
      // `sync` installs exactly what the lockfile pins; without one there is only `install`.
      return command('pipenv', [target.locked ? 'sync' : 'install', '--dev'], target, title);
    case 'pip':
      return command(
        interpreter(target.venv),
        ['-m', 'pip', 'install', '-r', path.basename(target.manifestPath)],
        target,
        title,
      );
    default:
      throw new Error(unmanaged(target));
  }
}

/**
 * Says why a project's packages cannot be changed for it.
 * @param target The project.
 * @returns Returns the reason, in the user's terms.
 */
function unmanaged(target: CommandTarget): string {
  return `Studio can't tell which tool manages ${path.basename(target.manifestPath)}: there is no uv.lock or poetry.lock, and no [tool.uv] or [tool.poetry] table. Make one with uv or Poetry, or change the file by hand.`;
}

/**
 * Builds a command run in the project's folder.
 * @param executable The program.
 * @param args The arguments.
 * @param target The project.
 * @param title The terminal's title.
 * @returns Returns the command.
 */
function command(
  executable: string,
  args: readonly string[],
  target: CommandTarget,
  title: string,
): PackageCommand {
  return { executable, args, cwd: path.dirname(target.manifestPath), title };
}

/**
 * Names the interpreter pip is run under: the project's environment's, so packages go into it and
 * not into whichever Python is first on the path, or `python3` (`python` on Windows) when it has none.
 * @param venv The environment, or null.
 * @returns Returns the program.
 */
function interpreter(venv: string | null): string {
  if (venv === null) {
    return process.platform === 'win32' ? 'python' : 'python3';
  }
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

/**
 * Builds the arguments that tell uv where a package is declared.
 * @param placement Where it is.
 * @returns Returns the arguments.
 */
function uvPlacement(placement: Placement): readonly string[] {
  if (placement.kind === 'optional') {
    if (placement.extra === null) {
      throw new Error('That optional dependency belongs to no extra uv can name.');
    }
    return ['--optional', checkGroup(placement.extra)];
  }
  if (placement.kind === 'group') {
    return placement.group === 'dev' ? ['--dev'] : ['--group', checkGroup(placement.group)];
  }
  return [];
}

/**
 * Builds the arguments that tell Poetry which group a package is in.
 * @param placement Where it is.
 * @returns Returns the arguments.
 */
function groupFlag(placement: Placement): readonly string[] {
  return placement.kind === 'group' ? ['--group', checkGroup(placement.group)] : [];
}

/**
 * Checks a package name before it reaches an argument list.
 * @param name The name.
 * @throws When it is not a package name.
 */
function checkName(name: string): void {
  if (!isPackageName(name)) {
    throw new Error(`'${name}' is not a package name.`);
  }
}

/**
 * Checks a version before it reaches an argument list.
 * @param version The version, or null.
 * @throws When it is not a version.
 */
function checkVersion(version: string | null): void {
  if (version !== null && !(VERSION_CHARACTERS.test(version) && isValidVersion(version))) {
    throw new Error(`'${version}' is not a version.`);
  }
}

/**
 * Checks an extra's or a group's name before it reaches an argument list.
 * @param name The name.
 * @returns Returns the name.
 * @throws When it is not one.
 */
function checkGroup(name: string): string {
  if (!GROUP_NAME.test(name)) {
    throw new Error(`'${name}' is not a group name.`);
  }
  return name;
}
