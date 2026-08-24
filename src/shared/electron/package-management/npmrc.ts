/**
 * Pure parsing and resolution of npm's `.npmrc` configuration: the default registry, per-scope
 * registries, and per-registry authentication. Kept free of Node imports so it is unit-testable; the
 * npm source layer pairs it with the filesystem. Only the read-time concerns a package view needs are
 * modelled — registry routing and auth headers — not npm's full config surface.
 */

/**
 * An authentication entry for a registry prefix, as declared by `//host/path/:_authToken` (bearer) or
 * `//host/path/:_auth` (basic) lines in an `.npmrc`.
 */
export interface NpmAuthEntry {
  /**
   * Gets the scheme-less registry prefix the credential applies to (for example `//npm.pkg.github.com/`).
   */
  readonly prefix: string;

  /**
   * Gets the bearer token (`_authToken`), when the entry is token-based.
   */
  readonly token?: string;

  /**
   * Gets the base64 basic-auth blob (`_auth`, or built from `username`/`_password`), when the entry is
   * basic.
   */
  readonly basic?: string;
}

/**
 * A resolved `.npmrc` configuration: the default registry, the scope-to-registry map, and the
 * per-registry authentication entries.
 */
export interface NpmrcConfig {
  /**
   * Gets the default registry URL, or null when none is set.
   */
  readonly registry: string | null;

  /**
   * Gets the scope-to-registry map (keys include the leading `@`, for example `@myorg`).
   */
  readonly scopedRegistries: Readonly<Record<string, string>>;

  /**
   * Gets the authentication entries, in precedence order (earlier wins on a prefix tie).
   */
  readonly auth: readonly NpmAuthEntry[];
}

/**
 * The resolved endpoint a registry request is made to: the registry base URL and the headers (auth)
 * that request carries.
 */
export interface NpmEndpoint {
  /**
   * Gets the registry base URL (no trailing slash).
   */
  readonly registry: string;

  /**
   * Gets the request headers, including any resolved authorization.
   */
  readonly headers: Record<string, string>;
}

/**
 * An empty configuration, used as the base of a merge and when no `.npmrc` is present.
 */
export const EMPTY_NPMRC: NpmrcConfig = { registry: null, scopedRegistries: {}, auth: [] };

/**
 * Interpolates `${VAR}` references in an `.npmrc` value from the environment, leaving an unset variable
 * as an empty string (npm's own behaviour), so a token stored as `${NPM_TOKEN}` resolves at read time
 * rather than being committed in the file.
 * @param value The raw value.
 * @param env The environment to resolve references from.
 * @returns Returns the interpolated value.
 */
function interpolate(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match: string, name: string): string => env[name] ?? '');
}

/**
 * Parses an `.npmrc` file's contents into a {@link NpmrcConfig}: the default registry, scoped
 * registries, and per-registry auth (bearer tokens and basic credentials), with `${ENV}` references
 * interpolated. Comment and blank lines are ignored; unrecognised keys are skipped.
 * @param contents The `.npmrc` file contents.
 * @param env The environment used to interpolate `${VAR}` references.
 * @returns Returns the parsed configuration.
 */
export function parseNpmrc(contents: string, env: Record<string, string | undefined>): NpmrcConfig {
  let registry: string | null = null;
  const scopedRegistries: Record<string, string> = {};
  const auth: Map<
    string,
    { token?: string; basic?: string; username?: string; password?: string }
  > = new Map<string, { token?: string; basic?: string; username?: string; password?: string }>();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line: string = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    const separator: number = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key: string = line.slice(0, separator).trim();
    const value: string = interpolate(line.slice(separator + 1).trim(), env);

    if (key === 'registry') {
      registry = stripTrailingSlash(value);
      continue;
    }
    const scoped: RegExpExecArray | null = /^(@[^:]+):registry$/.exec(key);
    if (scoped !== null) {
      scopedRegistries[scoped[1]] = stripTrailingSlash(value);
      continue;
    }
    const credential: RegExpExecArray | null =
      /^(\/\/.+?):(_authToken|_auth|username|_password)$/.exec(key);
    if (credential !== null) {
      const prefix: string = credential[1].endsWith('/') ? credential[1] : `${credential[1]}/`;
      const entry: { token?: string; basic?: string; username?: string; password?: string } =
        auth.get(prefix) ?? {};
      if (credential[2] === '_authToken') {
        entry.token = value;
      } else if (credential[2] === '_auth') {
        entry.basic = value;
      } else if (credential[2] === 'username') {
        entry.username = value;
      } else {
        entry.password = value;
      }
      auth.set(prefix, entry);
    }
  }

  return {
    registry,
    scopedRegistries,
    auth: [...auth.entries()].map(
      ([prefix, entry]: [
        string,
        { token?: string; basic?: string; username?: string; password?: string },
      ]): NpmAuthEntry => ({ prefix, ...finaliseAuth(entry) }),
    ),
  };
}

/**
 * Reduces a collected credential into a token or basic blob: a bearer token wins; otherwise an explicit
 * `_auth` blob; otherwise a basic blob built from `username` and the base64 `_password`.
 * @param entry The collected credential fields.
 * @returns Returns the token or basic form.
 */
function finaliseAuth(entry: {
  token?: string;
  basic?: string;
  username?: string;
  password?: string;
}): { token?: string; basic?: string } {
  if (entry.token !== undefined) {
    return { token: entry.token };
  }
  if (entry.basic !== undefined) {
    return { basic: entry.basic };
  }
  if (entry.username !== undefined && entry.password !== undefined) {
    const password: string = decodeBase64(entry.password);
    return { basic: encodeBase64(`${entry.username}:${password}`) };
  }
  return {};
}

/**
 * Merges two configurations, with the override taking precedence: its registry (when set) and scoped
 * registries win, and its auth entries are tried first.
 * @param base The lower-precedence configuration.
 * @param override The higher-precedence configuration.
 * @returns Returns the merged configuration.
 */
export function mergeNpmrc(base: NpmrcConfig, override: NpmrcConfig): NpmrcConfig {
  return {
    registry: override.registry ?? base.registry,
    scopedRegistries: { ...base.scopedRegistries, ...override.scopedRegistries },
    auth: [...override.auth, ...base.auth],
  };
}

/**
 * Resolves the endpoint a package's latest-version lookup should target: the scope's registry when the
 * package is scoped and a scoped registry is configured, otherwise the default registry (falling back
 * to the public registry), with the matching auth applied as a request header.
 * @param config The resolved configuration.
 * @param packageName The package name (possibly `@scope/name`).
 * @param fallbackRegistry The registry used when neither a scoped nor a default registry is configured.
 * @returns Returns the endpoint.
 */
export function resolveNpmEndpoint(
  config: NpmrcConfig,
  packageName: string,
  fallbackRegistry: string,
): NpmEndpoint {
  const scope: string | null = packageName.startsWith('@')
    ? packageName.slice(0, packageName.indexOf('/'))
    : null;
  const registry: string = stripTrailingSlash(
    (scope !== null ? config.scopedRegistries[scope] : undefined) ??
      config.registry ??
      fallbackRegistry,
  );
  return { registry, headers: authHeaders(config.auth, registry) };
}

/**
 * Builds the authorization headers for a registry URL by matching it against the configured auth
 * prefixes, choosing the longest matching prefix (npm's own precedence).
 * @param auth The auth entries.
 * @param registry The registry URL.
 * @returns Returns the headers (empty when no credential matches).
 */
function authHeaders(auth: readonly NpmAuthEntry[], registry: string): Record<string, string> {
  const schemeless: string = `${registry.replace(/^https?:/, '')}/`;
  let best: NpmAuthEntry | null = null;
  for (const entry of auth) {
    if (
      schemeless.startsWith(entry.prefix) &&
      (best === null || entry.prefix.length > best.prefix.length)
    ) {
      best = entry;
    }
  }
  if (best === null) {
    return {};
  }
  if (best.token !== undefined && best.token.length > 0) {
    return { Authorization: `Bearer ${best.token}` };
  }
  if (best.basic !== undefined && best.basic.length > 0) {
    return { Authorization: `Basic ${best.basic}` };
  }
  return {};
}

/**
 * Strips a trailing slash from a URL, so registry URLs compose predictably.
 * @param url The URL.
 * @returns Returns the URL without a trailing slash.
 */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Decodes a base64 string, tolerating a malformed value by returning it unchanged.
 * @param value The base64 value.
 * @returns Returns the decoded string.
 */
function decodeBase64(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

/**
 * Encodes a string as base64.
 * @param value The value.
 * @returns Returns the base64 encoding.
 */
function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}
