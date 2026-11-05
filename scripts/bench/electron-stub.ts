import { tmpdir } from 'node:os';

/**
 * Stands in for `electron` in a benchmark bundle: main-process modules import it for types and the
 * odd lookup, and a benchmark runs in plain node, never touching real user data.
 */
export const app: Record<string, unknown> = {
  isPackaged: false,
  // A bench that writes user data points this at its own mkdtemp; there is no way to reach a real one.
  getPath: (): string => process.env['STUDIO_BENCH_USER_DATA'] ?? tmpdir(),
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

/**
 * Stands in for the custom-protocol registry.
 */
export const protocol: Record<string, unknown> = {};
