/**
 * Stands in for `electron` in a benchmark bundle: main-process modules import it for types and the
 * odd lookup, and a benchmark runs in plain node, never touching real user data.
 */
export const app: Record<string, unknown> = {
  isPackaged: false,
  getPath: (): string => process.env['TMPDIR'] ?? '/tmp',
};

/**
 * Stands in for the IPC registry, which a benchmark never goes through.
 */
export const ipcMain: Record<string, unknown> = {
  handle: (): void => undefined,
  on: (): void => undefined,
};

/**
 * Stands in for the shell module.
 */
export const shell: Record<string, unknown> = {};

/**
 * Stands in for the dialog module.
 */
export const dialog: Record<string, unknown> = {};

/**
 * Stands in for the BrowserWindow class.
 */
export class BrowserWindow {}
