import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../logger';

/**
 * Runs a child process and resolves with its output, used for interpreter probes.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

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
function venvPython(venv: string): string {
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
 * Finds the interpreter a *project* should be debugged with: its own virtual environment when it has
 * one, otherwise a detected system interpreter. Deliberately distinct from Studio's managed
 * environment — the debugger runs from the plugin's payload, but the debuggee must run under the
 * project's interpreter, or none of its dependencies are importable.
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
