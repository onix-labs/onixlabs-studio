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
 * @param root The absolute workspace root.
 * @param env The environment used to interpolate `%VAR%` references in config values.
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
  const rootConfig: NuGetConfig | null = await readConfigIn(root, env);
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
 * Merges parsed configs (in application order) into resolved sources: nuget.org is the seed, each
 * config's operations apply in order (`clear` resets, `add` sets/overrides by name), and credentials
 * from later configs win and become auth headers.
 * @param configs The parsed configs, in application order (outer first).
 * @returns Returns the resolved sources.
 */
export function resolveSources(configs: readonly NuGetConfig[]): readonly NuGetSource[] {
  const urls: Map<string, string> = new Map<string, string>([['nuget.org', NUGET_ORG_INDEX]]);
  const credentials: Map<string, SourceCredential> = new Map<string, SourceCredential>();
  for (const config of configs) {
    for (const operation of config.operations) {
      applyOperation(urls, operation);
    }
    for (const [name, credential] of Object.entries(config.credentials)) {
      credentials.set(name, credential);
    }
  }
  return [...urls.entries()].map(([name, url]: [string, string]): NuGetSource => ({
    name,
    url,
    headers: authHeaders(credentials.get(normaliseSourceName(name))),
  }));
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
