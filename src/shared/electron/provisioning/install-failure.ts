// Why the last install of a plugin failed, in words a user can act on.
//
// The provisioners answer null on failure, by design: a missing component degrades to "unavailable"
// rather than taking its caller down. That kept the reason in the log and out of the Plugin Manager,
// so a fresh install that failed told the user only that "the application log records what failed".
// A provisioner records the reason here, against the plugin's id, where it logs it; the Plugin Manager
// takes it when the install comes back null.

/**
 * Describes the kinds of install failure a user can tell apart and act on differently.
 */
export type InstallFailureKind = 'offline' | 'unreachable' | 'mismatch' | 'disk' | 'broken';

/**
 * Describes why an install failed.
 */
export interface InstallFailure {
  /**
   * Gets the kind of failure.
   */
  readonly kind: InstallFailureKind;

  /**
   * Gets the HTTP status the download was answered with, for an unreachable download.
   */
  readonly status?: number;

  /**
   * Gets the system error code, for a failure to write to disk.
   */
  readonly code?: string;
}

/**
 * The failures recorded and not yet taken, by plugin id.
 */
const failures: Map<string, InstallFailure> = new Map<string, InstallFailure>();

/**
 * The system error codes that mean the network could not be reached at all.
 */
const OFFLINE_CODES: ReadonlySet<string> = new Set<string>([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * The system error codes that mean the install could not be written.
 */
const DISK_CODES: ReadonlySet<string> = new Set<string>([
  'ENOSPC',
  'EACCES',
  'EPERM',
  'EROFS',
  'EDQUOT',
]);

/**
 * Records why an install failed. A later failure of the same install replaces an earlier one, so what
 * is taken is the reason the install finally gave up.
 * @param id The plugin's id.
 * @param failure Why it failed.
 */
export function recordInstallFailure(id: string, failure: InstallFailure): void {
  failures.set(id, failure);
}

/**
 * Takes the recorded reason an install failed, forgetting it.
 * @param id The plugin's id.
 * @returns Returns the reason, or null when none was recorded.
 */
export function takeInstallFailure(id: string): InstallFailure | null {
  const failure: InstallFailure | null = failures.get(id) ?? null;
  failures.delete(id);
  return failure;
}

/**
 * Gets the system error code an error carries, looking through `fetch`'s wrapping `cause`.
 * @param error The error.
 * @returns Returns the code, or null when it carries none.
 */
function codeOf(error: unknown): string | null {
  for (let current: unknown = error, depth: number = 0; depth < 4; depth++) {
    if (typeof current !== 'object' || current === null) {
      return null;
    }
    const code: unknown = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Classifies an error an install threw.
 * @param error The error.
 * @returns Returns why the install failed.
 */
export function classifyInstallError(error: unknown): InstallFailure {
  const code: string | null = codeOf(error);
  if (code !== null && DISK_CODES.has(code)) {
    return { kind: 'disk', code };
  }
  if (code !== null && OFFLINE_CODES.has(code)) {
    return { kind: 'offline' };
  }
  const message: string = error instanceof Error ? error.message : String(error);
  // `downloadTo` reports an unsuccessful response as "Download failed: <status>".
  const status: RegExpExecArray | null = /^Download failed: (\d{3})$/.exec(message);
  if (status !== null) {
    return { kind: 'unreachable', status: Number(status[1]) };
  }
  // `fetch` itself says only "fetch failed" when it never got a response.
  if (message === 'fetch failed') {
    return { kind: 'offline' };
  }
  return { kind: 'broken' };
}

/**
 * Describes a failed install to the user: what happened, and what to do about it.
 * @param name The plugin's name.
 * @param failure Why it failed, or null when nothing was recorded.
 * @returns Returns the message.
 */
export function installFailureMessage(name: string, failure: InstallFailure | null): string {
  switch (failure?.kind) {
    case 'offline':
      return `${name} could not be installed: Studio could not reach the download server. Check your internet connection, then try again.`;
    case 'unreachable':
      return `${name} could not be installed: the download server answered ${failure.status}. Try again later; if it keeps failing, updating Studio may help.`;
    case 'mismatch':
      return `${name} could not be installed: what Studio downloaded was not exactly what it expected, so it was discarded. Try again; if it keeps failing, updating Studio usually fixes it.`;
    case 'disk':
      return `${name} could not be installed: Studio could not write it to disk (${failure.code}). Check there is free space and that Studio's data folder is writable.`;
    case 'broken':
      return `${name} could not be installed: its download did not contain what it should. Updating Studio usually fixes it; the application log has the details.`;
    default:
      return `${name} could not be installed. The application log records what failed.`;
  }
}
