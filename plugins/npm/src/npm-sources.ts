import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EMPTY_NPMRC,
  mergeNpmrc,
  NpmEndpoint,
  NpmrcConfig,
  parseNpmrc,
  registryEndpoint,
  resolveNpmEndpoint,
} from './npmrc';

/**
 * The public npm registry, used when no `.npmrc` names a default (or scoped) registry.
 */
export const DEFAULT_REGISTRY: string = 'https://registry.npmjs.org';

/**
 * The npm configuration file name.
 */
const NPMRC: string = '.npmrc';

/**
 * The empty environment a project-level `.npmrc` is interpolated from, so none of its `${VAR}`
 * references can reach the user's environment.
 */
const NO_ENVIRONMENT: Readonly<Record<string, string | undefined>> = Object.freeze({});

/**
 * A registry a folder can search: its display name, with the endpoint it is reached at.
 */
export interface NpmSource {
  /**
   * Gets the name shown to the user. ⛔ This is all of it that leaves the plugin.
   */
  readonly name: string;

  /**
   * Gets the registry URL and the headers its requests carry.
   */
  readonly endpoint: NpmEndpoint;
}

/**
 * Reads the effective `.npmrc` configuration for a workspace root by merging the user-level `~/.npmrc`
 * with the project-level `<root>/.npmrc` (project wins), so a scoped registry and its token declared
 * either place drive latest-version lookups. Absent files contribute nothing.
 *
 * ⛔ The environment is the plugin's own, which Studio cuts down to an allow-list: a `${NPM_TOKEN}`
 * reference to a variable outside it resolves to nothing, and the request goes without a credential
 * rather than the plugin being handed the user's whole shell.
 *
 * ⛔ Only the user-level file interpolates `${VAR}` references. A project's `.npmrc` arrives with the
 * folder, so it could name a registry of its own and a credential of `${ANY_VAR}`, and the panel would
 * send that variable there on load; its references resolve to nothing instead. Literal tokens in either
 * file still work.
 * @param root The absolute workspace root.
 * @param env The environment used to interpolate `${VAR}` references in the user-level `.npmrc`.
 * @returns Returns the merged configuration.
 */
export async function readNpmConfig(
  root: string,
  env: Record<string, string | undefined>,
): Promise<NpmrcConfig> {
  const home: NpmrcConfig = await readOne(path.join(os.homedir(), NPMRC), env);
  const project: NpmrcConfig = await readOne(path.join(root, NPMRC), NO_ENVIRONMENT);
  return mergeNpmrc(home, project);
}

/**
 * Resolves the registry endpoint (URL and auth headers) a package's latest-version lookup should
 * target, from a merged configuration.
 * @param config The merged `.npmrc` configuration.
 * @param packageName The package name (possibly scoped).
 * @returns Returns the endpoint.
 */
export function endpointFor(config: NpmrcConfig, packageName: string): NpmEndpoint {
  return resolveNpmEndpoint(config, packageName, DEFAULT_REGISTRY);
}

/**
 * Lists the registries a folder can search: the default one, named `npm` when it is the public registry
 * and after its host otherwise, then each scoped registry as `@scope (host)`.
 * @param config The merged `.npmrc` configuration.
 * @returns Returns the sources, the default first.
 */
export function sourcesFrom(config: NpmrcConfig): readonly NpmSource[] {
  const registry: string = config.registry ?? DEFAULT_REGISTRY;
  const sources: NpmSource[] = [
    {
      name: isPublicRegistry(registry) ? 'npm' : hostOf(registry),
      endpoint: registryEndpoint(config, registry),
    },
  ];
  for (const [scope, scoped] of Object.entries(config.scopedRegistries)) {
    sources.push({
      name: `${scope} (${hostOf(scoped)})`,
      endpoint: registryEndpoint(config, scoped),
    });
  }
  return sources;
}

/**
 * Determines whether a registry is the public one, which no user's token is asked for.
 * @param registry The registry URL.
 * @returns Returns true for the public registry.
 */
export function isPublicRegistry(registry: string): boolean {
  return registry.replace(/\/+$/, '') === DEFAULT_REGISTRY;
}

/**
 * Reads the host out of a registry URL, for a source's name. Only the host: a URL can carry a user and
 * password, and a name goes to the renderer.
 * @param registry The registry URL.
 * @returns Returns the host, or a neutral name when it is not a URL.
 */
function hostOf(registry: string): string {
  try {
    return new URL(registry).host;
  } catch {
    return 'registry';
  }
}

/**
 * Reads and parses a single `.npmrc`, or the empty configuration when it is absent or unreadable.
 * @param filePath The absolute `.npmrc` path.
 * @param env The environment used to interpolate references.
 * @returns Returns the parsed configuration.
 */
async function readOne(
  filePath: string,
  env: Record<string, string | undefined>,
): Promise<NpmrcConfig> {
  try {
    return parseNpmrc(await fs.readFile(filePath, 'utf8'), env);
  } catch {
    return EMPTY_NPMRC;
  }
}
