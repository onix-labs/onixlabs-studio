import { app } from 'electron';
import * as path from 'node:path';
import {
  ensureVenvPackage,
  isVenvReady,
  removeVenv,
  venvPython,
} from '../provisioning/python-environment';

/**
 * Holds the pinned debugpy version. Pinned like every other plugin, so every machine installs the same
 * debugger; bumping it installs into a fresh, version-scoped environment.
 */
export const DEBUGPY_VERSION: string = '1.8.21';

/**
 * Holds the module debugpy provides, verified importable before an install is called done.
 */
const DEBUGPY_MODULE: string = 'debugpy';

/**
 * Gets the directory the pinned debugpy environment lives in.
 *
 * debugpy is the one plugin that is neither an archive nor a binary: it is a Python package, so it is
 * installed into a virtual environment Studio owns. That environment is Studio's, not the user's — the
 * debuggee runs under the *project's* interpreter, which the Python project system resolves separately.
 * @returns Returns the environment root.
 */
function debugpyVenv(): string {
  return path.join(app.getPath('userData'), 'debug-adapters', 'debugpy', DEBUGPY_VERSION);
}

/**
 * Gets the interpreter of the installed debugpy environment, or null when it is not installed.
 * @returns Returns the interpreter path, or null.
 */
export function debugpyInterpreter(): string | null {
  const venv: string = debugpyVenv();
  return isVenvReady(venv, DEBUGPY_MODULE) ? venvPython(venv) : null;
}

/**
 * Gets whether debugpy is installed.
 * @returns Returns true when the environment is ready.
 */
export function isDebugpyInstalled(): boolean {
  return isVenvReady(debugpyVenv(), DEBUGPY_MODULE);
}

/**
 * Installs the pinned debugpy into its managed environment.
 * @returns Returns the environment's interpreter path, or null when the install failed.
 */
export function installDebugpy(): Promise<string | null> {
  return ensureVenvPackage(
    debugpyVenv(),
    `${DEBUGPY_MODULE}==${DEBUGPY_VERSION}`,
    DEBUGPY_MODULE,
    null,
  );
}

/**
 * Removes the managed debugpy environment.
 * @returns Returns a promise that resolves once it is gone.
 */
export function uninstallDebugpy(): Promise<void> {
  return removeVenv(debugpyVenv());
}
