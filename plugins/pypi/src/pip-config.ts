// Finds the package indexes a folder's lookups go to: pip's own configuration, read the way pip reads
// it — the user's `pip.conf` (`pip.ini` on Windows), then the file `PIP_CONFIG_FILE` names, then
// `PIP_INDEX_URL` / `PIP_EXTRA_INDEX_URL` — falling back to PyPI.
//
// ⛔ Only the user's configuration is read, never a project's. A project's index options (a
// requirements file's `--index-url`, `[[tool.uv.index]]`, Poetry's sources) would let a folder the
// user opened choose where the plugin sends its lookups, and with them any credential.
//
// A private index's credential is the user and password in its URL, as pip takes it, and it goes only
// to that URL's own host: it is bound to the index it was written in. ⛔ It is never sent over plain
// http (loopback aside, which never leaves the machine), and the URL it was in never becomes a source's
// name, which goes to the renderer.
//
// Studio passes plugins an allow-listed environment, so `PIP_*` variables are usually absent; they are
// read when they are there.

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IniDocument, parseIni } from './ini';
import { note } from './log';

/**
 * PyPI's simple index, pip's default.
 */
export const PYPI_INDEX: string = 'https://pypi.org/simple/';

/**
 * The name PyPI is shown by.
 */
export const PYPI_NAME: string = 'PyPI';

/**
 * A package index lookups go to.
 */
export interface PipIndex {
  /**
   * Gets the name shown to the user. ⛔ This is all of it that leaves the plugin.
   */
  readonly name: string;

  /**
   * Gets the index's simple-API URL, without a credential, ending in `/`.
   */
  readonly url: string;

  /**
   * Gets the headers its requests carry: an `Authorization` when the configuration holds one.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Gets whether it is PyPI, which is asked through its JSON API and never with a credential.
   */
  readonly isPypi: boolean;
}

/**
 * The index settings one configuration source gives, each absent when it does not set it.
 */
interface IndexSettings {
  /**
   * Gets the main index.
   */
  readonly indexUrl?: string;

  /**
   * Gets the extra indexes.
   */
  readonly extraIndexUrls?: readonly string[];
}

/**
 * Reads the indexes a folder's lookups go to, the main one first.
 * @param env The plugin's environment.
 * @returns Returns the indexes; PyPI alone when nothing else is configured.
 */
export async function readPipIndexes(
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly PipIndex[]> {
  let indexUrl: string = PYPI_INDEX;
  let extras: readonly string[] = [];
  const apply: (settings: IndexSettings) => void = (settings: IndexSettings): void => {
    indexUrl = settings.indexUrl ?? indexUrl;
    extras = settings.extraIndexUrls ?? extras;
  };
  for (const file of await userConfigFiles(env)) {
    const text: string | null = await readText(file);
    if (text !== null) {
      apply(settingsFromConfig(parseIni(text)));
    }
  }
  apply(settingsFromEnvironment(env));

  const indexes: PipIndex[] = [];
  for (const url of [indexUrl, ...extras]) {
    const index: PipIndex | null = indexFrom(url);
    if (index !== null && !indexes.some((known: PipIndex): boolean => known.url === index.url)) {
      indexes.push({ ...index, name: uniqueName(index.name, indexes) });
    }
  }
  return indexes.length > 0 ? indexes : [indexFrom(PYPI_INDEX)!];
}

/**
 * Reads an index URL as pip takes one: an http(s) URL, perhaps with a user and password in it.
 * @param raw The URL, as configured.
 * @returns Returns the index, or null when it is not an http(s) URL.
 */
export function indexFrom(raw: string): PipIndex | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  const username: string = safeDecode(url.username);
  const password: string = safeDecode(url.password);
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  const clean: string = url.toString();
  const isPypi: boolean =
    url.protocol === 'https:' &&
    (url.host === 'pypi.org' || url.host === 'pypi.python.org') &&
    url.pathname === '/simple/';
  return {
    name: isPypi ? PYPI_NAME : nameOf(url),
    url: clean,
    headers: isPypi ? {} : credentialHeaders(url, username, password),
    isPypi,
  };
}

/**
 * Determines whether a URL may carry a credential: https, or http to this machine.
 * @param url The URL.
 * @returns Returns true when it may.
 */
export function mayCarryCredential(url: URL): boolean {
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
  );
}

/**
 * Builds HTTP basic authorization, as pip sends a URL's user and password.
 * @param username The user.
 * @param password The password or token.
 * @returns Returns the headers.
 */
export function basicAuthorization(username: string, password: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
  };
}

/**
 * Builds the headers for a URL's own credential, when it has one and may carry it. A `${VAR}` in it
 * is not expanded: the plugin's environment is not the user's, and a credential is never assembled
 * from it.
 * @param url The URL, its credential removed.
 * @param username The user it had.
 * @param password The password it had.
 * @returns Returns the headers; none when there is no credential to send.
 */
function credentialHeaders(url: URL, username: string, password: string): Record<string, string> {
  if (username.length === 0 && password.length === 0) {
    return {};
  }
  if (`${username}${password}`.includes('${')) {
    note('pypi', 'An index credential refers to an environment variable, so none is sent');
    return {};
  }
  if (!mayCarryCredential(url)) {
    note('pypi', 'An index over plain http has a credential in its URL; it is not sent');
    return {};
  }
  return basicAuthorization(username, password);
}

/**
 * Names an index after its host and path, less the `/simple` most end in: the name goes to the
 * renderer, so ⛔ never the user, password or query.
 * @param url The URL.
 * @returns Returns the name.
 */
function nameOf(url: URL): string {
  const trimmed: string = url.pathname.replace(/\/+$/, '').replace(/\/simple$/, '');
  return `${url.host}${trimmed}`;
}

/**
 * Makes a name unique among the indexes already named, so a search can name one source.
 * @param name The name.
 * @param indexes The indexes named so far.
 * @returns Returns the name, numbered when it is taken.
 */
function uniqueName(name: string, indexes: readonly PipIndex[]): string {
  let candidate: string = name;
  for (
    let number: number = 2;
    indexes.some((index: PipIndex): boolean => index.name === candidate);
    number += 1
  ) {
    candidate = `${name} (${number})`;
  }
  return candidate;
}

/**
 * Reads the index settings of one configuration file: `[global]`, then `[install]` over it, as
 * `pip install` reads them. pip accepts `_` for `-` in a key.
 * @param ini The file.
 * @returns Returns the settings it gives.
 */
function settingsFromConfig(ini: IniDocument): IndexSettings {
  let settings: IndexSettings = {};
  for (const section of ['global', 'install']) {
    const keys: Map<string, string> = new Map<string, string>();
    for (const [key, value] of ini.get(section) ?? new Map<string, string>()) {
      keys.set(key.replaceAll('_', '-'), value);
    }
    const indexUrl: string | undefined = keys.get('index-url')?.trim();
    const extras: string | undefined = keys.get('extra-index-url');
    settings = {
      indexUrl: indexUrl !== undefined && indexUrl.length > 0 ? indexUrl : settings.indexUrl,
      extraIndexUrls: extras !== undefined ? splitList(extras) : settings.extraIndexUrls,
    };
  }
  return settings;
}

/**
 * Reads the index settings of the environment.
 * @param env The plugin's environment.
 * @returns Returns the settings it gives.
 */
function settingsFromEnvironment(env: Readonly<Record<string, string | undefined>>): IndexSettings {
  const indexUrl: string | undefined = env['PIP_INDEX_URL']?.trim();
  const extras: string | undefined = env['PIP_EXTRA_INDEX_URL'];
  return {
    indexUrl: indexUrl !== undefined && indexUrl.length > 0 ? indexUrl : undefined,
    extraIndexUrls: extras !== undefined ? splitList(extras) : undefined,
  };
}

/**
 * Lists the user's configuration files, in the order pip applies them (later wins): the legacy
 * location, the current one, then `PIP_CONFIG_FILE`.
 * @param env The plugin's environment.
 * @returns Returns the paths, whether or not they exist.
 */
async function userConfigFiles(
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const home: string = os.homedir();
  const files: string[] = [];
  if (process.platform === 'win32') {
    files.push(path.join(home, 'pip', 'pip.ini'));
    files.push(
      path.join(env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), 'pip', 'pip.ini'),
    );
  } else {
    files.push(path.join(home, '.pip', 'pip.conf'));
    if (
      process.platform === 'darwin' &&
      (await exists(path.join(home, 'Library', 'Application Support', 'pip')))
    ) {
      files.push(path.join(home, 'Library', 'Application Support', 'pip', 'pip.conf'));
    } else {
      const xdg: string | undefined = env['XDG_CONFIG_HOME'];
      const base: string =
        process.platform !== 'darwin' && xdg !== undefined && path.isAbsolute(xdg)
          ? xdg
          : path.join(home, '.config');
      files.push(path.join(base, 'pip', 'pip.conf'));
    }
  }
  const named: string | undefined = env['PIP_CONFIG_FILE'];
  if (named !== undefined && named.length > 0 && named !== os.devNull) {
    files.push(named);
  }
  return files;
}

/**
 * Splits a list of URLs, which pip separates with whitespace or newlines.
 * @param value The list.
 * @returns Returns the URLs.
 */
function splitList(value: string): readonly string[] {
  return value.split(/\s+/).filter((url: string): boolean => url.length > 0);
}

/**
 * Decodes a URL's percent-encoded user or password.
 * @param value The encoded part.
 * @returns Returns it decoded, or as it was when it is malformed.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Determines whether a path exists.
 * @param target The path.
 * @returns Returns true when it does.
 */
async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a text file, or null when it is absent or unreadable.
 * @param filePath The path.
 * @returns Returns the text, or null.
 */
async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}
