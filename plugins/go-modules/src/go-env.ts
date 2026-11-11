// The Go environment this plugin honours: where module lookups go (`GOPROXY`), which modules must not
// go there (`GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`), and whether `.netrc` is read for proxy credentials
// (`GOAUTH`).
//
// The go command reads each from the process environment first and from its own environment file
// second — the file `go env -w` writes, at `os.UserConfigDir()/go/env` unless `GOENV` names another.
// This plugin does the same. Studio hands a plugin an allow-listed environment; since #1423 that list
// carries `GOPROXY`, `GOPRIVATE`, `GONOPROXY` and `GONOSUMDB`, so a value exported in a shell profile
// is seen as well as one written with `go env -w`. ⚠️ `GOAUTH` and `NETRC` are not on it, so for those
// the file is still what is read.

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { note } from './log';

/**
 * The proxy list the go command uses when nothing sets one.
 */
export const DEFAULT_GOPROXY: string = 'https://proxy.golang.org,direct';

/**
 * The variables this plugin reads.
 */
const VARIABLES: readonly string[] = [
  'GOPROXY',
  'GOPRIVATE',
  'GONOPROXY',
  'GONOSUMDB',
  'GOAUTH',
  'NETRC',
];

/**
 * One entry of a `GOPROXY` list.
 */
export type GoProxyEntry =
  /**
   * A module proxy, by URL.
   */
  | {
      readonly kind: 'proxy';

      /**
       * Gets the proxy's URL, without a trailing slash. It may carry a user and password.
       */
      readonly url: string;

      /**
       * Gets whether the next entry is tried after any failure (`|`), rather than only after the
       * proxy says it does not have the module (`,`: 404 or 410).
       */
      readonly fallBackOnAnyError: boolean;
    }
  /**
   * `direct`: the go command fetches from version control itself, which this plugin does not do.
   */
  | { readonly kind: 'direct' }
  /**
   * `off`: no module may be fetched at all.
   */
  | { readonly kind: 'off' };

/**
 * The Go settings a lookup is made under.
 */
export interface GoEnvironment {
  /**
   * Gets the proxy list, in order.
   */
  readonly proxies: readonly GoProxyEntry[];

  /**
   * Gets the patterns of modules the go command fetches directly, never through a proxy: `GONOPROXY`,
   * or `GOPRIVATE` when that is unset.
   */
  readonly noProxy: readonly string[];

  /**
   * Gets the patterns of modules not checked against the public checksum database: `GONOSUMDB`, or
   * `GOPRIVATE` when that is unset. Their names are private, so they are not sent to a public proxy.
   */
  readonly noSumDb: readonly string[];

  /**
   * Gets whether `.netrc` is read for proxy credentials: `GOAUTH` is unset or names `netrc`.
   */
  readonly netrc: boolean;

  /**
   * Gets the `.netrc` file's path.
   */
  readonly netrcPath: string;
}

/**
 * Finds the directory the go command keeps its environment file under: Go's `os.UserConfigDir()`.
 * @param env The environment.
 * @param platform The operating system.
 * @returns Returns the directory.
 */
export function userConfigDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string {
  const home: string = env['HOME'] ?? env['USERPROFILE'] ?? os.homedir();
  if (platform === 'win32') {
    return env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support');
  }
  const xdg: string | undefined = env['XDG_CONFIG_HOME'];
  return xdg !== undefined && path.isAbsolute(xdg) ? xdg : path.join(home, '.config');
}

/**
 * Reads the go command's environment file: `KEY=VALUE` lines, as `go env -w` writes them.
 * @param text The file.
 * @returns Returns the values set.
 */
export function parseGoEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line: string = raw.trim();
    const equals: number = line.indexOf('=');
    if (line.length === 0 || line.startsWith('#') || equals <= 0) {
      continue;
    }
    values[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return values;
}

/**
 * Parses a `GOPROXY` list: entries separated by `,` (try the next only when the module is not found)
 * or `|` (try the next after any failure). Parsing stops at `off` or `direct`, which nothing after can
 * be reached past. An entry without a scheme is an https URL, as the go command reads it.
 * @param value The list.
 * @returns Returns its entries.
 */
export function parseGoProxy(value: string): readonly GoProxyEntry[] {
  const entries: GoProxyEntry[] = [];
  const parts: readonly string[] = value.split(/([,|])/);
  for (let index: number = 0; index < parts.length; index += 2) {
    const entry: string = parts[index].trim();
    const fallBackOnAnyError: boolean = parts[index + 1] === '|';
    if (entry.length === 0) {
      continue;
    }
    if (entry === 'off' || entry === 'direct') {
      entries.push({ kind: entry });
      break;
    }
    const url: string = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `https://${entry}`;
    entries.push({ kind: 'proxy', url: url.replace(/\/+$/, ''), fallBackOnAnyError });
  }
  return entries;
}

/**
 * Splits a comma-separated pattern list, dropping empty entries and trailing slashes.
 * @param value The list, or undefined.
 * @returns Returns the patterns.
 */
function patterns(value: string | undefined): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((pattern: string): string => pattern.trim().replace(/\/+$/, ''))
    .filter((pattern: string): boolean => pattern.length > 0);
}

/**
 * Builds the settings from what the environment and the environment file say, the environment
 * winning, as it does for the go command.
 * @param values The values, already merged.
 * @param env The environment, for the home folder.
 * @returns Returns the settings.
 */
export function goEnvironmentFrom(
  values: Record<string, string | undefined>,
  env: Record<string, string | undefined>,
): GoEnvironment {
  const proxy: string =
    values['GOPROXY'] !== undefined && values['GOPROXY'].length > 0
      ? values['GOPROXY']
      : DEFAULT_GOPROXY;
  const privatePatterns: readonly string[] = patterns(values['GOPRIVATE']);
  const auth: string = (values['GOAUTH'] ?? 'netrc').trim();
  const home: string = env['HOME'] ?? env['USERPROFILE'] ?? os.homedir();
  return {
    proxies: parseGoProxy(proxy),
    noProxy: values['GONOPROXY'] !== undefined ? patterns(values['GONOPROXY']) : privatePatterns,
    noSumDb: values['GONOSUMDB'] !== undefined ? patterns(values['GONOSUMDB']) : privatePatterns,
    netrc:
      auth.length === 0 || auth.split(';').some((part: string): boolean => part.trim() === 'netrc'),
    netrcPath:
      values['NETRC'] !== undefined && values['NETRC'].length > 0
        ? values['NETRC']
        : path.join(home, process.platform === 'win32' ? '_netrc' : '.netrc'),
  };
}

/**
 * Reads the Go settings: the plugin's environment first, then the go command's environment file.
 * @param env The plugin's environment, which Studio has already cut down to an allow-list.
 * @returns Returns the settings.
 */
export async function readGoEnvironment(
  env: Record<string, string | undefined>,
): Promise<GoEnvironment> {
  const file: Record<string, string> = await readEnvFile(env);
  const values: Record<string, string | undefined> = {};
  for (const name of VARIABLES) {
    values[name] = env[name] ?? file[name];
  }
  return goEnvironmentFrom(values, env);
}

/**
 * Reads the go command's environment file, or nothing when it is absent or `GOENV=off`.
 * @param env The environment.
 * @returns Returns the values it sets.
 */
async function readEnvFile(
  env: Record<string, string | undefined>,
): Promise<Record<string, string>> {
  const named: string | undefined = env['GOENV'];
  if (named === 'off') {
    return {};
  }
  const file: string =
    named !== undefined && named.length > 0 ? named : path.join(userConfigDir(env), 'go', 'env');
  try {
    return parseGoEnvFile(await fs.readFile(file, 'utf8'));
  } catch {
    note('go-env', 'No go environment file, so the defaults apply');
    return {};
  }
}

/**
 * Turns one `path.Match` pattern into a regular expression: `*` is any run within one path element, `?`
 * one character within one, `[…]` a class, and `\` escapes the next character.
 * @param pattern The pattern.
 * @returns Returns the expression, or null when the pattern is malformed (it then matches nothing, as
 * the go command treats it).
 */
function globExpression(pattern: string): RegExp | null {
  let source: string = '';
  for (let index: number = 0; index < pattern.length; index += 1) {
    const character: string = pattern[index];
    if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '\\') {
      index += 1;
      if (index >= pattern.length) {
        return null;
      }
      source += pattern[index].replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    } else if (character === '[') {
      const end: number = pattern.indexOf(']', index + 1);
      if (end < 0) {
        return null;
      }
      let inner: string = pattern.slice(index + 1, end);
      const negated: boolean = inner.startsWith('^') || inner.startsWith('!');
      inner = (negated ? inner.slice(1) : inner).replace(/[\\\]^]/g, '\\$&');
      source += `[${negated ? '^/' : ''}${inner}]`;
      index = end;
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Determines whether a module path matches a `GOPRIVATE`-style pattern list, as the go command does:
 * a pattern matches when it matches the path's leading elements, as many as the pattern has. So
 * `example.com/corp` matches `example.com/corp/lib` but not `example.com/corporate`.
 * @param modulePath The module path.
 * @param list The patterns.
 * @returns Returns true when one matches.
 */
export function matchesPatterns(modulePath: string, list: readonly string[]): boolean {
  const elements: readonly string[] = modulePath.split('/');
  return list.some((pattern: string): boolean => {
    const count: number = pattern.split('/').length;
    if (count > elements.length) {
      return false;
    }
    const expression: RegExp | null = globExpression(pattern);
    return expression?.test(elements.slice(0, count).join('/')) === true;
  });
}
