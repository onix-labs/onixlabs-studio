/**
 * Renames server identifiers that have changed meaning, applied to every persisted id as it is read.
 * The Python server used to be identified by its *language* (`python`), which stopped working once a
 * language could be served by more than one implementation: the id now names the implementation
 * (`pyright`), so a settings file written before the change would otherwise silently disable, or pass
 * arguments to, a server that no longer exists.
 */
const LEGACY_SERVER_IDS: Readonly<Record<string, string>> = { python: 'pyright' };

/**
 * Applies {@link LEGACY_SERVER_IDS} to a persisted server identifier.
 * @param serverId The identifier as persisted.
 * @returns Returns the current identifier for that server.
 */
export function migrateServerId(serverId: string): string {
  return LEGACY_SERVER_IDS[serverId] ?? serverId;
}

/**
 * The persisted fields each server's path override used to have to itself, and the server they now
 * belong to. One field per server stopped working for the same reason the closed catalogue did: a
 * contributed server arrives from a manifest core has never heard of, and cannot have a field.
 */
const LEGACY_PATH_FIELDS: readonly (readonly [key: string, serverId: string])[] = [
  ['clangdPath', 'clangd'],
  ['typescriptServerPath', 'typescript'],
];

/**
 * Reads the per-server path overrides from persisted settings, forward-filling the two that used to
 * have a field of their own.
 *
 * The legacy fields are read but never written back: they are absent from the stored shape, so the
 * next save drops them. An explicit entry in the map wins over a legacy field, because the map is the
 * current shape and the field is only still read in case an old file carries one.
 * @param candidate The candidate settings object, unvalidated.
 * @returns Returns the normalised map, or null when a value is malformed.
 */
export function readServerPaths(candidate: Record<string, unknown>): Record<string, string> | null {
  const paths: Record<string, string> = {};
  const source: unknown = candidate['serverPaths'];
  if (source !== undefined) {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
      return null;
    }
    for (const [serverId, value] of Object.entries(source)) {
      if (typeof value !== 'string') {
        return null;
      }
      const trimmed: string = value.trim();
      if (trimmed.length > 0) {
        paths[migrateServerId(serverId)] = trimmed;
      }
    }
  }
  for (const [key, serverId] of LEGACY_PATH_FIELDS) {
    const legacy: unknown = candidate[key];
    if (legacy === undefined || legacy === null) {
      continue;
    }
    if (typeof legacy !== 'string') {
      return null;
    }
    const trimmed: string = legacy.trim();
    if (trimmed.length > 0 && paths[serverId] === undefined) {
      paths[serverId] = trimmed;
    }
  }
  return paths;
}
