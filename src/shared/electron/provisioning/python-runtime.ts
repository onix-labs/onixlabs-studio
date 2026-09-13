import { detectPython } from './python-environment';
import { logger } from '../logger';

/**
 * Holds the interpreter found at start-up: a path when one was found, null when the machine has none,
 * and undefined before the search has run.
 */
let interpreter: string | null | undefined;

/**
 * Finds the interpreter a `python` plugin will run under, once per launch.
 *
 * Resolved eagerly at start-up rather than when a plugin spawns, because the spawn paths a
 * contribution resolves through are synchronous — a decoder answers whether it can run without
 * awaiting anything — and probing an interpreter means executing it. Doing that once, early, is what
 * lets {@link pythonRuntime} stay synchronous.
 *
 * Must be called after the login shell's environment is hydrated: a GUI-launched application does not
 * inherit the PATH a shell would, and Python is usually only on the shell's.
 * @returns Returns a promise that resolves once the search has run.
 */
export async function hydratePythonRuntime(): Promise<void> {
  interpreter = await detectPython(null);
  logger.info(
    'PythonRuntime',
    interpreter === null
      ? 'No supported Python interpreter found; Python plugins will report themselves unavailable'
      : `Python plugins will run under ${interpreter}`,
  );
}

/**
 * Builds how to run a plugin's Python entry point.
 *
 * The entry point is run as a *script* rather than through `-m`, so nothing has to be said about
 * packages or import paths: a Python entry point that expects to be run this way arranges its own
 * imports, exactly as a Node one does.
 * @param entryPoint The entry point to run.
 * @returns Returns the command and arguments, or null when the machine has no usable interpreter.
 */
export function pythonRuntime(entryPoint: string): { command: string; args: string[] } | null {
  return interpreter === undefined || interpreter === null
    ? null
    : { command: interpreter, args: [entryPoint] };
}

/**
 * Overrides the detected interpreter. For tests, which must not depend on what the machine running
 * them happens to have installed.
 * @param value The interpreter to report, or null to report none.
 */
export function setPythonRuntimeForTesting(value: string | null): void {
  interpreter = value;
}
