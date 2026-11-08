import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  NuGetConfig,
  normaliseSourceName,
  parseNuGetConfig,
  SourceCredential,
  SourceOperation,
} from './nuget-config';
import { logger } from '../logger';

/**
 * The public nuget.org v3 service index, the implicit default source when no config clears it.
 */
const NUGET_ORG_INDEX: string = 'https://api.nuget.org/v3/index.json';

/**
 * The empty environment a repository-level config is interpolated from, so none of its `%VAR%`
 * references can reach the user's environment.
 */
const NO_ENVIRONMENT: Readonly<Record<string, string | undefined>> = Object.freeze({});

/**
 * A resolved NuGet package source: its name, URL, and the request headers (auth) queries carry.
 */
export interface NuGetSource {
  /**
   * Gets the source name.
   */
  readonly name: string;

  /**
   * Gets the source URL (a v3 service index or a package base address).
   */
  readonly url: string;

  /**
   * Gets the request headers, including any resolved authorization.
   */
  readonly headers: Record<string, string>;
}

/**
 * Reads the effective NuGet package sources for a workspace root: the user-level `NuGet.Config` merged
 * with the repository-root `nuget.config` (later wins, and a `<clear/>` resets inherited sources), with
 * credentials applied as auth headers. Seeded with nuget.org so the public source is present unless a
 * config clears it. Per-subdirectory configs are not merged (the common case declares feeds at the
 * repository root or user level).
 *
 * ⛔ Only the user-level config interpolates `%VAR%` references. A repository's `nuget.config` arrives
 * with the folder, so it could name a feed of its own and a password of `%ANY_VAR%`; its references
 * resolve to nothing instead. Literal credentials in either config still work.
 * @param root The absolute workspace root.
 * @param env The environment used to interpolate `%VAR%` references in the user-level config.
 * @returns Returns the resolved sources.
 */
export async function readNuGetSources(
  root: string,
  env: Record<string, string | undefined>,
): Promise<readonly NuGetSource[]> {
  const configs: NuGetConfig[] = [];
  const user: NuGetConfig | null = await readConfig(userConfigPath(), env);
  if (user !== null) {
    configs.push(user);
  }
  const rootConfig: NuGetConfig | null = await readConfigIn(root, NO_ENVIRONMENT);
  if (rootConfig !== null) {
    configs.push(rootConfig);
  }
  const sources: readonly NuGetSource[] = resolveSources(configs);
  logger.debug(
    'nuget-sources',
    `Resolved ${sources.length} NuGet source(s) for '${root}' from ${configs.length} config(s).`,
  );
  return sources;
}

/**
 * A credential as the merge holds it: the credential, and the URL its source had in the config that
 * declared it, or null when that config left no single source of that name.
 */
interface BoundCredential {
  /**
   * Gets the credential.
   */
  readonly credential: SourceCredential;

  /**
   * Gets the URL the credential was declared for, or null when it was declared for none.
   */
  readonly url: string | null;
}

/**
 * Merges parsed configs (in application order) into resolved sources: nuget.org is the seed, each
 * config's operations apply in order (`clear` resets, `add` sets/overrides by name), and credentials
 * from later configs win and become auth headers.
 *
 * ⛔ Credentials are keyed by source name, and a later config can redefine a name. So each credential
 * is bound to the URL its source had once the declaring config's operations were applied, and goes
 * only to a source whose final URL is still that one. Without this a project's `nuget.config` could
 * point the name of a feed the user saved a password for at a host of its own.
 * @param configs The parsed configs, in application order (outer first).
 * @returns Returns the resolved sources.
 */
export function resolveSources(configs: readonly NuGetConfig[]): readonly NuGetSource[] {
  const urls: Map<string, string> = new Map<string, string>([['nuget.org', NUGET_ORG_INDEX]]);
  const credentials: Map<string, BoundCredential> = new Map<string, BoundCredential>();
  for (const config of configs) {
    for (const operation of config.operations) {
      applyOperation(urls, operation);
    }
    for (const [name, credential] of Object.entries(config.credentials)) {
      credentials.set(name, { credential, url: urlNamed(urls, name) });
    }
  }
  return [...urls.entries()].map(([name, url]: [string, string]): NuGetSource => {
    const bound: BoundCredential | undefined = credentials.get(normaliseSourceName(name));
    return {
      name,
      url,
      headers: bound?.url === url && mayCarryCredentials(url) ? authHeaders(bound.credential) : {},
    };
  });
}

/**
 * Finds the URL of the source a normalised name refers to in the merge so far.
 * @param urls The accumulating sources.
 * @param normalisedName The normalised source name.
 * @returns Returns the URL, or null when no source, or more than one URL, answers to the name.
 */
function urlNamed(urls: ReadonlyMap<string, string>, normalisedName: string): string | null {
  const found: Set<string> = new Set<string>();
  for (const [name, url] of urls) {
    if (normaliseSourceName(name) === normalisedName) {
      found.add(url);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The hosts a plain-http feed may still be sent a credential at, because the traffic never leaves the
 * machine.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set<string>(['localhost', '127.0.0.1', '[::1]']);

/**
 * Determines whether a request to a source may carry a credential: only over https, or over plain
 * http to loopback, so a password never crosses the network in clear.
 * @param url The source URL.
 * @returns Returns true when an Authorization header may be attached.
 */
export function mayCarryCredentials(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') {
    return true;
  }
  return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
}

/**
 * Applies one source operation to the accumulating name-to-URL map.
 * @param urls The accumulating sources.
 * @param operation The operation.
 */
function applyOperation(urls: Map<string, string>, operation: SourceOperation): void {
  if (operation.kind === 'clear') {
    urls.clear();
  } else {
    urls.set(operation.name, operation.url);
  }
}

/**
 * Builds the authorization headers for a source's credential: HTTP basic from the username and
 * cleartext password/token (private NuGet feeds — GitHub Packages, Azure Artifacts — authenticate a
 * personal access token as the basic password). Absent credentials yield no headers.
 * @param credential The source credential, or undefined.
 * @returns Returns the headers.
 */
function authHeaders(credential: SourceCredential | undefined): Record<string, string> {
  if (credential?.password === undefined || credential.password.length === 0) {
    return {};
  }
  const blob: string = Buffer.from(
    `${credential.username ?? ''}:${credential.password}`,
    'utf8',
  ).toString('base64');
  return { Authorization: `Basic ${blob}` };
}

/**
 * Resolves the user-level NuGet config path for the platform.
 * @returns Returns the absolute path.
 */
function userConfigPath(): string {
  if (process.platform === 'win32') {
    const appData: string = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'NuGet', 'NuGet.Config');
  }
  return path.join(os.homedir(), '.nuget', 'NuGet', 'NuGet.Config');
}

/**
 * Reads and parses a NuGet config at an exact path, or null when absent or unreadable.
 * @param filePath The absolute config path.
 * @param env The environment used to interpolate references.
 * @returns Returns the parsed config, or null.
 */
async function readConfig(
  filePath: string,
  env: Record<string, string | undefined>,
): Promise<NuGetConfig | null> {
  try {
    return parseNuGetConfig(await fs.readFile(filePath, 'utf8'), env);
  } catch {
    return null;
  }
}

/**
 * Reads a repository config from a directory, tolerating either casing of the file name.
 * @param directory The directory to read the config from.
 * @param env The environment used to interpolate references.
 * @returns Returns the parsed config, or null when none is present.
 */
async function readConfigIn(
  directory: string,
  env: Record<string, string | undefined>,
): Promise<NuGetConfig | null> {
  return (
    (await readConfig(path.join(directory, 'nuget.config'), env)) ??
    (await readConfig(path.join(directory, 'NuGet.Config'), env))
  );
}
