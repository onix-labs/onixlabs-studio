import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../logger';

/**
 * Runs a child process and resolves with its output, used for interpreter probes and package installs.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * Bounds the buffered output of a `pip install`, generous so a verbose install is not truncated.
 */
const INSTALL_BUFFER: number = 32 * 1024 * 1024;

/**
 * Matches the version reported by `python --version`, capturing major and minor.
 */
const VERSION_PATTERN: RegExp = /Python (\d+)\.(\d+)/;

/**
 * The lowest Python the tooling supports. debugpy dropped support below this, and a machine with an
 * older interpreter would fail at install rather than at use, which is the better place to say so.
 */
const MINIMUM_MAJOR: number = 3;

/**
 * The lowest supported Python minor version within {@link MINIMUM_MAJOR}.
 */
const MINIMUM_MINOR: number = 8;

/**
 * Gets the path of a virtual environment's Python executable, which differs by platform.
 * @param venv The virtual environment's root directory.
 * @returns Returns the interpreter path.
 */
export function venvPython(venv: string): string {
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

/**
 * Detects a usable Python interpreter: the user's override when given, then the conventional names on
 * the PATH, provided it reports a high enough version.
 * @param override The user's configured interpreter, or null to auto-detect.
 * @returns Returns the interpreter to run, or null when none is suitable.
 */
export async function detectPython(override: string | null = null): Promise<string | null> {
  const candidates: string[] = [];
  if (override !== null && override.length > 0) {
    candidates.push(override);
  }
  candidates.push(process.platform === 'win32' ? 'python.exe' : 'python3', 'python');
  for (const candidate of candidates) {
    if (await isSupportedPython(candidate)) {
      logger.debug('PythonEnvironment', `Detected Python at ${candidate}`);
      return candidate;
    }
  }
  logger.debug('PythonEnvironment', 'No supported Python interpreter found');
  return null;
}

/**
 * Determines whether an interpreter runs and reports a supported version.
 * @param executable The interpreter to probe.
 * @returns Returns true when it is usable.
 */
async function isSupportedPython(executable: string): Promise<boolean> {
  try {
    const { stdout, stderr }: { stdout: string; stderr: string } = await execFileAsync(executable, [
      '--version',
    ]);
    // Older Pythons report the version on stderr; newer ones on stdout.
    const match: RegExpExecArray | null = VERSION_PATTERN.exec(`${stdout} ${stderr}`);
    if (match === null) {
      return false;
    }
    const major: number = Number(match[1]);
    const minor: number = Number(match[2]);
    return major > MINIMUM_MAJOR || (major === MINIMUM_MAJOR && minor >= MINIMUM_MINOR);
  } catch {
    return false;
  }
}

/**
 * Gets whether a managed virtual environment exists with its package importable.
 *
 * Checks the *module*, not just the directory: a virtual environment whose creation succeeded but whose
 * install failed would otherwise report as ready and fail at the point of use instead.
 * @param venv The virtual environment's root directory.
 * @param moduleName The module the environment was created to provide.
 * @returns Returns true when the environment is usable.
 */
export function isVenvReady(venv: string, moduleName: string): boolean {
  const python: string = venvPython(venv);
  if (!existsSync(python)) {
    return false;
  }
  return existsSync(path.join(venv, 'lib')) || existsSync(path.join(venv, 'Lib'))
    ? existsSync(marker(venv, moduleName))
    : false;
}

/**
 * Gets the path of the marker written once a package install has completed, so a half-finished install
 * is never mistaken for a working one.
 * @param venv The virtual environment's root directory.
 * @param moduleName The module the environment provides.
 * @returns Returns the marker path.
 */
function marker(venv: string, moduleName: string): string {
  return path.join(venv, `.studio-${moduleName}-installed`);
}

/**
 * Creates a managed virtual environment and installs a pinned package into it. The environment is
 * Studio's own, kept away from the user's projects and interpreters: installing into the system Python
 * or into a project's environment would change something that is not ours to change.
 * @param venv The virtual environment's root directory.
 * @param requirement The pinned pip requirement to install (for example `debugpy==1.8.21`).
 * @param moduleName The module the requirement provides, verified after the install.
 * @param pythonOverride The interpreter to build the environment with, or null to detect one.
 * @returns Returns the environment's interpreter path, or null when it could not be created.
 */
export async function ensureVenvPackage(
  venv: string,
  requirement: string,
  moduleName: string,
  pythonOverride: string | null = null,
): Promise<string | null> {
  const python: string = venvPython(venv);
  if (isVenvReady(venv, moduleName)) {
    return python;
  }
  const interpreter: string | null = await detectPython(pythonOverride);
  if (interpreter === null) {
    logger.warn('PythonEnvironment', `Cannot install ${requirement}: no Python interpreter found`);
    return null;
  }
  try {
    // Start from clean ground: a previous attempt may have left a partial environment behind.
    await fs.rm(venv, { recursive: true, force: true });
    await fs.mkdir(path.dirname(venv), { recursive: true });
    logger.info('PythonEnvironment', `Creating virtual environment at ${venv}`);
    await execFileAsync(interpreter, ['-m', 'venv', venv], { maxBuffer: INSTALL_BUFFER });
    logger.info('PythonEnvironment', `Installing ${requirement}`);
    await execFileAsync(
      python,
      ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', requirement],
      { maxBuffer: INSTALL_BUFFER },
    );
    // Prove the module imports before claiming the environment is ready.
    await execFileAsync(python, ['-c', `import ${moduleName}`], { maxBuffer: INSTALL_BUFFER });
    await fs.writeFile(marker(venv, moduleName), requirement, 'utf8');
    logger.info('PythonEnvironment', `Installed ${requirement} into ${venv}`);
    return python;
  } catch (error: unknown) {
    logger.error('PythonEnvironment', `Failed to install ${requirement}`, error);
    await fs.rm(venv, { recursive: true, force: true });
    return null;
  }
}

/**
 * Removes a managed virtual environment.
 * @param venv The virtual environment's root directory.
 * @returns Returns a promise that resolves once it is gone.
 */
export async function removeVenv(venv: string): Promise<void> {
  logger.info('PythonEnvironment', `Removing virtual environment ${venv}`);
  await fs.rm(venv, { recursive: true, force: true });
}

/**
 * Finds the interpreter a *project* should be debugged with: its own virtual environment when it has
 * one, otherwise a detected system interpreter. Deliberately distinct from Studio's managed
 * environment — debugpy runs from ours, but the debuggee must run under the project's, or none of its
 * dependencies are importable.
 * @param root The project root.
 * @returns Returns the interpreter path, or null when none is found.
 */
export async function projectInterpreter(root: string): Promise<string | null> {
  for (const name of ['.venv', 'venv', 'env']) {
    const candidate: string = venvPython(path.join(root, name));
    if (existsSync(candidate)) {
      logger.debug('PythonEnvironment', `Using the project's own interpreter at ${candidate}`);
      return candidate;
    }
  }
  return detectPython(null);
}
