// Reads the remotes Conan is configured with, and the credentials for them.
//
// Both live in the user's Conan home (`~/.conan2`), never in a project, so a folder cannot add a remote
// or point a credential at a host of its choosing:
// - `remotes.json` lists the remotes, in the order Conan tries them. With no file Conan uses
//   ConanCenter alone, and so does this plugin.
// - `credentials.json` is Conan's own optional file of a user and password per remote name. Conan
//   renders it as a Jinja template, so a value may be `{{ os.getenv(…) }}`; this plugin does not run
//   templates, and a value that holds one is treated as no credential at all. The tokens Conan saves
//   after `conan remote login` are in its own database, which is not read.
//
// `CONAN_HOME` would move the home elsewhere, but Studio gives a plugin an allow-listed environment
// that does not carry it, so the default home is the one read.

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * ConanCenter, the remote Conan is configured with out of the box.
 */
export const CONAN_CENTER: { readonly name: string; readonly url: string } = {
  name: 'conancenter',
  url: 'https://center2.conan.io',
};

/**
 * The hosts of ConanCenter, the public remote: Studio is never asked for a credential for one.
 */
const PUBLIC_HOSTS: ReadonlySet<string> = new Set<string>(['center2.conan.io', 'center.conan.io']);

/**
 * One remote, with the headers its requests carry.
 */
export interface ConanRemote {
  /**
   * Gets the remote's name, as Conan names it. ⛔ The name, never the URL, goes to the renderer.
   */
  readonly name: string;

  /**
   * Gets the remote's URL, without a trailing slash.
   */
  readonly url: string;

  /**
   * Gets the headers its requests carry: an `Authorization` when a credential applies, else none.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A user and password from `credentials.json`.
 */
export interface ConanCredential {
  /**
   * Gets the user.
   */
  readonly user: string;

  /**
   * Gets the password or token.
   */
  readonly password: string;
}

/**
 * Finds the Conan home.
 * @param env The environment, already cut down to Studio's allow-list.
 * @returns Returns the home's absolute path.
 */
export function conanHome(env: Record<string, string | undefined>): string {
  return path.join(env['HOME'] ?? env['USERPROFILE'] ?? os.homedir(), '.conan2');
}

/**
 * Reads a JSON file.
 * @param file The absolute path.
 * @returns Returns the parsed content, or undefined when it is absent or not JSON.
 */
async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Reads the enabled remotes, in Conan's order. A remote whose URL is not http or https is skipped.
 * @param home The Conan home.
 * @returns Returns the remotes, ConanCenter alone when there is no `remotes.json`.
 */
export async function readRemotes(
  home: string,
): Promise<readonly { readonly name: string; readonly url: string }[]> {
  const file: unknown = await readJson(path.join(home, 'remotes.json'));
  const listed: unknown =
    typeof file === 'object' && file !== null ? (file as Record<string, unknown>)['remotes'] : null;
  if (!Array.isArray(listed)) {
    return [CONAN_CENTER];
  }
  const remotes: { readonly name: string; readonly url: string }[] = [];
  for (const entry of listed) {
    const record: Record<string, unknown> | null =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    const name: unknown = record?.['name'];
    const url: unknown = record?.['url'];
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      typeof url !== 'string' ||
      !/^https?:\/\//i.test(url) ||
      record?.['disabled'] === true
    ) {
      continue;
    }
    remotes.push({ name, url: url.replace(/\/+$/, '') });
  }
  return remotes;
}

/**
 * Reads `credentials.json`: a user and password per remote name. A value holding a Jinja template is
 * not a credential this plugin can read, so its entry is left out.
 * @param home The Conan home.
 * @returns Returns the credentials by remote name.
 */
export async function readCredentials(home: string): Promise<ReadonlyMap<string, ConanCredential>> {
  const file: unknown = await readJson(path.join(home, 'credentials.json'));
  const listed: unknown =
    typeof file === 'object' && file !== null
      ? (file as Record<string, unknown>)['credentials']
      : null;
  const credentials: Map<string, ConanCredential> = new Map<string, ConanCredential>();
  for (const entry of Array.isArray(listed) ? listed : []) {
    const record: Record<string, unknown> | null =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    const remote: unknown = record?.['remote'];
    const user: unknown = record?.['user'];
    const password: unknown = record?.['password'];
    if (
      typeof remote === 'string' &&
      typeof user === 'string' &&
      typeof password === 'string' &&
      password.length > 0 &&
      ![user, password].some((value: string): boolean => /\{\{|\{%/.test(value))
    ) {
      credentials.set(remote, { user, password });
    }
  }
  return credentials;
}

/**
 * Determines whether a remote's URL is https, the only scheme a credential is ever sent over.
 * @param url The URL.
 * @returns Returns true when it is https.
 */
export function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/**
 * Determines whether a remote is ConanCenter, which needs no credential.
 * @param url The remote's URL.
 * @returns Returns true when it is public.
 */
export function isPublicRemote(url: string): boolean {
  try {
    return PUBLIC_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Builds the header a user and password are sent with.
 * @param credential The credential.
 * @returns Returns the headers.
 */
export function basicHeaders(credential: ConanCredential): Record<string, string> {
  const encoded: string = Buffer.from(`${credential.user}:${credential.password}`).toString(
    'base64',
  );
  return { Authorization: `Basic ${encoded}` };
}

/**
 * Builds the header a token saved in Studio is sent with.
 * @param token The token.
 * @returns Returns the headers.
 */
export function bearerHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
