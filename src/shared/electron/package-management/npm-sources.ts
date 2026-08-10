import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EMPTY_NPMRC,
  mergeNpmrc,
  NpmEndpoint,
  NpmrcConfig,
  parseNpmrc,
  resolveNpmEndpoint,
} from './npmrc';
import { logger } from '../logger';

/**
 * The public npm registry, used when no `.npmrc` names a default (or scoped) registry.
 */
const DEFAULT_REGISTRY: string = 'https://registry.npmjs.org';

/**
 * The npm configuration file name.
 */
const NPMRC: string = '.npmrc';

/**
 * Reads the effective `.npmrc` configuration for a workspace root by merging the user-level `~/.npmrc`
 * with the project-level `<root>/.npmrc` (project wins), so a scoped registry and its token declared
 * either place drive latest-version lookups. Absent files contribute nothing.
 * @param root The absolute workspace root.
 * @param env The environment used to interpolate `${VAR}` references in `.npmrc` values.
 * @returns Returns the merged configuration.
 */
export async function readNpmConfig(
  root: string,
  env: Record<string, string | undefined>,
): Promise<NpmrcConfig> {
  const home: NpmrcConfig = await readOne(path.join(os.homedir(), NPMRC), env);
  const project: NpmrcConfig = await readOne(path.join(root, NPMRC), env);
  const merged: NpmrcConfig = mergeNpmrc(home, project);
  logger.debug(
    'npm-sources',
    `Resolved .npmrc for '${root}': default registry ${merged.registry ?? DEFAULT_REGISTRY}, ` +
      `${Object.keys(merged.scopedRegistries).length} scoped registry/ies.`,
  );
  return merged;
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
