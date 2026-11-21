/**
 * Polled folders (#1254): the folders, such as network shares and container mounts, whose files Studio
 * checks on a timer instead of trusting the operating system to report changes. Native watching stays
 * the default everywhere; a watcher whose root lies inside one of these folders polls instead.
 *
 * The list is a setting of the machine rather than of a workspace (a mount point means nothing on
 * another computer), so it lives in Settings › Workspaces › File Watching and is mirrored to the main
 * process with the other startup settings. Keep this module platform-neutral: the renderer cleans the
 * list with it and the main process matches watcher roots with it.
 */

/**
 * Holds the polling intervals offered, in seconds.
 */
export const POLLING_INTERVALS: readonly number[] = [1, 2, 5, 10, 30];

/**
 * Holds the polling interval used until one is chosen, in seconds. Two seconds keeps an explorer
 * feeling live without walking a share's tree more often than a person can notice.
 */
export const DEFAULT_POLLING_INTERVAL: number = 2;

/**
 * Holds the longest folder path accepted.
 */
const MAX_PATH_LENGTH: number = 1024;

/**
 * Holds the most folders one list may carry, bounding untrusted input.
 */
const MAX_FOLDERS: number = 100;

/**
 * Determines whether paths are compared without regard to case on a platform. macOS and Windows
 * format their disks case-insensitive by default, so `/Volumes/Share` and `/volumes/share` name one
 * folder there; a case-sensitive APFS volume is rare enough that matching it loosely costs at most a
 * folder polled that need not be.
 * @param platform The Node platform name (`process.platform`).
 * @returns Returns true when paths are compared case-insensitively.
 */
export function isCaseInsensitivePlatform(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Determines whether a path is absolute on any platform Studio runs on: a POSIX path, a Windows drive
 * path, or a Windows UNC path.
 * @param value The path, with either separator.
 * @returns Returns true when the path is absolute.
 */
function isAbsoluteFolder(value: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\|\/\/)/.test(value);
}

/**
 * Reduces a folder path to the form it is stored in: trimmed, with repeated separators collapsed, `.`
 * and `..` segments resolved, and no trailing separator except on a root. The separator the path was
 * written with is kept, so a Windows path still reads as one in Settings.
 * @param value The folder as chosen or typed.
 * @returns Returns the folder, or an empty string when it is not an absolute path or is unusable.
 */
export function normalisePollingFolder(value: string): string {
  const trimmed: string = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PATH_LENGTH || /[\n\r\0]/.test(trimmed)) {
    return '';
  }
  if (!isAbsoluteFolder(trimmed)) {
    return '';
  }
  const separator: string = trimmed.includes('\\') && !trimmed.startsWith('/') ? '\\' : '/';
  const unc: boolean = /^(\\\\|\/\/)/.test(trimmed);
  const drive: RegExpExecArray | null = /^([A-Za-z]:)/.exec(trimmed);
  const prefix: string = unc ? separator + separator : drive !== null ? drive[1] + separator : '/';
  const body: string = trimmed.slice(unc ? 2 : drive !== null ? 3 : 1);
  const segments: string[] = [];
  for (const segment of body.split(/[\\/]/)) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (unc && segments.length < 2) {
    // A UNC path names a share (\\server\share) before it names a folder.
    return '';
  }
  return prefix + segments.join(separator);
}

/**
 * Cleans a list of polled folders from settings or an untrusted request.
 * @param value The configured value.
 * @returns Returns the normalised folders, without blanks or duplicates, in their original order.
 */
export function sanitizePollingFolders(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const folders: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const folder: string = normalisePollingFolder(entry);
    if (folder === '' || seen.has(folder)) {
      continue;
    }
    seen.add(folder);
    folders.push(folder);
    if (folders.length >= MAX_FOLDERS) {
      break;
    }
  }
  return folders;
}

/**
 * Reads a polling interval from an untrusted value.
 * @param value The configured value, in seconds.
 * @returns Returns the interval when it is one of {@link POLLING_INTERVALS}, otherwise the default.
 */
export function sanitizePollingInterval(value: unknown): number {
  return typeof value === 'number' && POLLING_INTERVALS.includes(value)
    ? value
    : DEFAULT_POLLING_INTERVAL;
}

/**
 * Reduces a path to the form two paths are compared in: normalised, with `/` separators, and folded to
 * lower case where the platform ignores case.
 * @param value The absolute path.
 * @param caseInsensitive Whether the platform ignores case.
 * @returns Returns the comparable form, or an empty string when the path is not absolute.
 */
function comparable(value: string, caseInsensitive: boolean): string {
  const normalised: string = normalisePollingFolder(value).replace(/\\/g, '/');
  return caseInsensitive ? normalised.toLowerCase() : normalised;
}

/**
 * Determines whether a path is a folder or lies inside it. Trailing separators, repeated separators
 * and `.` segments on either side make no difference; case makes none where the platform ignores it.
 * Links are not followed here — the main process compares real paths as well (see `WatchModes`).
 * @param target The absolute path to test.
 * @param folder The absolute folder.
 * @param caseInsensitive Whether the platform ignores case.
 * @returns Returns true when the path is the folder or inside it.
 */
export function isWithinFolder(target: string, folder: string, caseInsensitive: boolean): boolean {
  const path: string = comparable(target, caseInsensitive);
  const container: string = comparable(folder, caseInsensitive);
  if (path === '' || container === '') {
    return false;
  }
  if (path === container) {
    return true;
  }
  const base: string = container.endsWith('/') ? container : `${container}/`;
  return path.startsWith(base);
}

/**
 * Finds the polled folder a path lies in.
 * @param target The absolute path to test.
 * @param folders The polled folders.
 * @param caseInsensitive Whether the platform ignores case.
 * @returns Returns the first folder containing the path, or undefined when none does.
 */
export function findPollingFolder(
  target: string,
  folders: readonly string[],
  caseInsensitive: boolean,
): string | undefined {
  return folders.find((folder: string): boolean => isWithinFolder(target, folder, caseInsensitive));
}
