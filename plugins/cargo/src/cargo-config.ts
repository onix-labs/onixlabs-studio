// Reads cargo's own configuration — `.cargo/config.toml` and `credentials.toml` — into the registries a
// folder can reach, each with the credential that may be sent to it.
//
// ⛔ The binding rule. A token in the user's `credentials.toml` (or the user's own config) is keyed by a
// registry's *name*, and a project's `.cargo/config.toml` can say where a name points. Read naively, a
// cloned repository could point `my-registry` at a host of its choosing and collect the user's token. So
// a user-level token goes only to the index the user-level config itself names, compared by origin; a
// registry only the project names gets the project's own token or, failing that, nothing from the
// user's files — and Studio is asked instead, which keys its tokens by URL. Cargo's configuration does
// not interpolate environment variables, so there is nothing a project can splice into a credential.

import { stringOf, tableOf, TomlTable } from './toml';

/**
 * The public registry's name, as dependencies and `[source]` refer to it.
 */
export const CRATES_IO: string = 'crates-io';

/**
 * The public registry's sparse index.
 */
export const CRATES_IO_INDEX: string = 'https://index.crates.io/';

/**
 * The name the public registry is shown under.
 */
export const CRATES_IO_DISPLAY: string = 'crates.io';

/**
 * One `[registries.<name>]` entry.
 */
export interface RegistryEntry {
  /**
   * Gets the index URL as written, `sparse+` and all, or null when this file does not name one.
   */
  readonly index: string | null;

  /**
   * Gets the token this file holds for it, or null.
   */
  readonly token: string | null;
}

/**
 * One `[source.<name>]` entry, the source-replacement table.
 */
export interface SourceEntry {
  /**
   * Gets the source it is replaced with, or null.
   */
  readonly replaceWith: string | null;

  /**
   * Gets the registry index it is, or null when it is a directory, a local registry or a git source.
   */
  readonly registry: string | null;
}

/**
 * One configuration file, read.
 */
export interface CargoConfig {
  /**
   * Gets `[registries]`, by name.
   */
  readonly registries: ReadonlyMap<string, RegistryEntry>;

  /**
   * Gets `[source]`, by name.
   */
  readonly sources: ReadonlyMap<string, SourceEntry>;
}

/**
 * A configuration with nothing in it, for a file that is absent or cannot be read.
 */
export const EMPTY_CONFIG: CargoConfig = {
  registries: new Map<string, RegistryEntry>(),
  sources: new Map<string, SourceEntry>(),
};

/**
 * A registry a folder can reach.
 */
export interface CargoRegistry {
  /**
   * Gets its name: `crates-io` or the `[registries]` key. ⛔ A name, never a URL: it goes to the renderer.
   */
  readonly name: string;

  /**
   * Gets the sparse index to read, an http(s) URL ending in `/`, or null when it has none this plugin
   * can read (a git index, a vendored directory, a local registry).
   */
  readonly index: string | null;

  /**
   * Gets the token configured for it and bound to its index, or null.
   */
  readonly token: string | null;

  /**
   * Gets whether it is crates.io itself, unreplaced: no credential is ever sent to it or asked for.
   */
  readonly isPublic: boolean;
}

/**
 * Reads a parsed `.cargo/config.toml`.
 * @param document The parsed file.
 * @returns Returns its registries and sources.
 */
export function readCargoConfig(document: TomlTable): CargoConfig {
  const registries: Map<string, RegistryEntry> = new Map<string, RegistryEntry>();
  for (const [name, value] of Object.entries(tableOf(document['registries']) ?? {})) {
    const entry: TomlTable | null = tableOf(value);
    if (entry !== null) {
      registries.set(name, {
        index: stringOf(entry['index']),
        token: nonEmpty(stringOf(entry['token'])),
      });
    }
  }
  const sources: Map<string, SourceEntry> = new Map<string, SourceEntry>();
  for (const [name, value] of Object.entries(tableOf(document['source']) ?? {})) {
    const entry: TomlTable | null = tableOf(value);
    if (entry !== null) {
      sources.set(name, {
        replaceWith: stringOf(entry['replace-with']),
        registry: stringOf(entry['registry']),
      });
    }
  }
  return { registries, sources };
}

/**
 * Reads a parsed `credentials.toml`: `[registries.<name>] token`. The crates.io token under `[registry]`
 * is not read at all, because nothing this plugin does with crates.io needs one.
 * @param document The parsed file.
 * @returns Returns the tokens, by registry name.
 */
export function readCredentials(document: TomlTable): ReadonlyMap<string, string> {
  const tokens: Map<string, string> = new Map<string, string>();
  for (const [name, value] of Object.entries(tableOf(document['registries']) ?? {})) {
    const token: string | null = nonEmpty(stringOf(tableOf(value)?.['token']));
    if (token !== null) {
      tokens.set(name, token);
    }
  }
  return tokens;
}

/**
 * Resolves the registries a folder can reach, crates.io first: the user's configuration under the
 * project's (the project wins, as cargo's nearer file does), with each token bound as the file comment
 * says.
 * @param user The user-level config (`$CARGO_HOME/config.toml`).
 * @param project The project's `.cargo/config.toml`.
 * @param credentials The user's `credentials.toml` tokens.
 * @returns Returns the registries.
 */
export function resolveRegistries(
  user: CargoConfig,
  project: CargoConfig,
  credentials: ReadonlyMap<string, string>,
): readonly CargoRegistry[] {
  const names: Set<string> = new Set<string>([
    ...user.registries.keys(),
    ...project.registries.keys(),
  ]);
  names.delete(CRATES_IO);
  const named: Map<string, CargoRegistry> = new Map<string, CargoRegistry>();
  for (const name of names) {
    named.set(name, resolveNamed(name, user, project, credentials));
  }
  return [resolveCratesIo(user, project, named), ...named.values()];
}

/**
 * Turns an index as written into the URL to read: `sparse+https://…/` reads as `https://…/`. An index
 * without `sparse+` is a git index, which cannot be read over plain HTTP, so it has none.
 * @param index The index as written.
 * @returns Returns the URL, ending in `/`, or null.
 */
export function sparseIndexUrl(index: string | null): string | null {
  if (!index?.startsWith('sparse+')) {
    return null;
  }
  const url: string = index.slice('sparse+'.length);
  try {
    const parsed: URL = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
  } catch {
    return null;
  }
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Resolves one `[registries.<name>]`.
 * @param name The registry's name.
 * @param user The user-level config.
 * @param project The project's config.
 * @param credentials The user's tokens.
 * @returns Returns the registry.
 */
function resolveNamed(
  name: string,
  user: CargoConfig,
  project: CargoConfig,
  credentials: ReadonlyMap<string, string>,
): CargoRegistry {
  const own: RegistryEntry | undefined = project.registries.get(name);
  const users: RegistryEntry | undefined = user.registries.get(name);
  const index: string | null = sparseIndexUrl(own?.index ?? users?.index ?? null);
  const userIndex: string | null = sparseIndexUrl(users?.index ?? null);
  const userToken: string | null = users?.token ?? credentials.get(name) ?? null;
  let token: string | null = own?.token ?? null;
  if (token === null && userToken !== null && index !== null && userIndex !== null) {
    token = originOf(index) === originOf(userIndex) ? userToken : null;
  }
  return { name, index, token, isPublic: false };
}

/**
 * Resolves crates.io, following `[source.crates-io] replace-with` when a mirror or vendored copy stands
 * in for it. A replacement naming a `[registries]` entry takes that entry's index and bound token; a
 * `[source.<name>] registry` takes its index and no token; a directory or local registry has no index.
 * @param user The user-level config.
 * @param project The project's config.
 * @param named The `[registries]` already resolved.
 * @returns Returns crates.io as this folder reaches it.
 */
function resolveCratesIo(
  user: CargoConfig,
  project: CargoConfig,
  named: ReadonlyMap<string, CargoRegistry>,
): CargoRegistry {
  const sourceOf: (name: string) => SourceEntry | undefined = (
    name: string,
  ): SourceEntry | undefined => project.sources.get(name) ?? user.sources.get(name);
  let current: string = CRATES_IO;
  const seen: Set<string> = new Set<string>();
  for (;;) {
    const replacement: string | null = sourceOf(current)?.replaceWith ?? null;
    if (replacement === null || seen.has(replacement)) {
      break;
    }
    seen.add(current);
    current = replacement;
  }
  if (current === CRATES_IO) {
    return { name: CRATES_IO, index: CRATES_IO_INDEX, token: null, isPublic: true };
  }
  const registry: CargoRegistry | undefined = named.get(current);
  if (registry !== undefined) {
    return { ...registry, name: CRATES_IO };
  }
  const index: string | null = sparseIndexUrl(sourceOf(current)?.registry ?? null);
  return { name: CRATES_IO, index, token: null, isPublic: false };
}

/**
 * Reads a URL's origin, the unit a credential is bound to.
 * @param url The URL.
 * @returns Returns the origin, or null when it is not a URL.
 */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Treats an empty string as nothing.
 * @param value The value.
 * @returns Returns the value, or null when it is empty or absent.
 */
function nonEmpty(value: string | null): string | null {
  return value === null || value.trim().length === 0 ? null : value;
}
