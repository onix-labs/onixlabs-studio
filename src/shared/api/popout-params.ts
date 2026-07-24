/**
 * Names the query-string key that marks a window's boot role, and the value naming the pop-out
 * shell. The main process stamps these onto a pop-out window's load URL; the renderer entry reads
 * them before bootstrapping to boot the minimal pop-out root instead of the full IDE.
 */
export const POPOUT_FLAG_KEY: string = 'window';

/**
 * Holds the {@link POPOUT_FLAG_KEY} value identifying a pop-out window.
 */
export const POPOUT_FLAG_VALUE: string = 'popout';

/**
 * Names the exact URL an auxiliary panel window is opened with — the ONE `window.open` target the
 * security guards allow. An auxiliary window shares the opener's renderer process, so the opener
 * builds its DOM directly and a dock panel renders into it with the workspace's own services; the
 * sentinel fragment keeps the allow surgically narrow (#116: everything else is still denied and
 * routed to the system browser).
 */
export const AUX_PANEL_URL: string = 'about:blank#studio-panel';

/**
 * Holds the maximum number of parameters a pop-out request may carry.
 */
const MAX_PARAMS: number = 16;

/**
 * Holds the maximum length of a single parameter value.
 */
const MAX_VALUE_LENGTH: number = 512;

/**
 * Holds the pattern parameter keys must match: a letter followed by letters, digits, or hyphens.
 */
const KEY_PATTERN: RegExp = /^[a-z][a-z0-9-]*$/i;

/**
 * Validates renderer-supplied pop-out parameters defensively, so a malformed request can never
 * smuggle an unexpected shape into a window's load URL. The whole request is rejected (null) on the
 * first invalid entry rather than silently repaired.
 * @param value The raw parameters from the renderer.
 * @returns Returns the validated parameters, or null when the value is not a usable parameter map.
 */
export function sanitizePopoutParams(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const entries: [string, unknown][] = Object.entries(value);
  if (entries.length > MAX_PARAMS) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (key === POPOUT_FLAG_KEY) {
      // The role flag is the main process's to stamp; a caller-supplied one is dropped, not obeyed.
      continue;
    }
    if (!KEY_PATTERN.test(key) || typeof entry !== 'string' || entry.length > MAX_VALUE_LENGTH) {
      return null;
    }
    params[key] = entry;
  }
  return params;
}

/**
 * Builds the query string a pop-out window is loaded with: the role flag first, then the given
 * parameters, URL-encoded.
 * @param params The validated pop-out parameters.
 * @returns Returns the query string, including its leading `?`.
 */
export function buildPopoutSearch(params: Readonly<Record<string, string>>): string {
  const search: URLSearchParams = new URLSearchParams();
  search.set(POPOUT_FLAG_KEY, POPOUT_FLAG_VALUE);
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value);
  }
  return `?${search.toString()}`;
}

/**
 * Parses a window's query string into pop-out parameters, identifying whether the window was opened
 * as a pop-out at all.
 * @param search The window's `location.search` (with or without the leading `?`).
 * @returns Returns the parameters (excluding the role flag), or null when the window is not a
 * pop-out.
 */
export function parsePopoutSearch(search: string): Record<string, string> | null {
  const parsed: URLSearchParams = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  if (parsed.get(POPOUT_FLAG_KEY) !== POPOUT_FLAG_VALUE) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [key, value] of parsed.entries()) {
    if (key !== POPOUT_FLAG_KEY) {
      params[key] = value;
    }
  }
  return params;
}
