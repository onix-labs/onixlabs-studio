/**
 * Pure parsing of NuGet's `nuget.config`: the package sources it declares (and any `<clear/>` that
 * resets inherited ones) and the per-source credentials. Kept free of Node imports so it is
 * unit-testable; the NuGet source layer pairs it with the filesystem and the hierarchical merge. The
 * XML is scanned with regular expressions — the shape is simple and well-formed, and this avoids a
 * dependency for a read-only view.
 */

/**
 * An ordered operation from a `<packageSources>` section: adding (or overriding) a named source, or a
 * `<clear/>` that resets the sources inherited so far.
 */
export type SourceOperation =
  | { readonly kind: 'clear' }
  | { readonly kind: 'add'; readonly name: string; readonly url: string };

/**
 * The credentials declared for one source.
 */
export interface SourceCredential {
  /**
   * Gets the username, when declared.
   */
  readonly username?: string;

  /**
   * Gets the cleartext password or access token, when declared. Encrypted passwords are not readable
   * off the machine that wrote them and are ignored.
   */
  readonly password?: string;
}

/**
 * A parsed `nuget.config`: the ordered source operations and the credentials keyed by normalised
 * (lower-cased, space-decoded) source name.
 */
export interface NuGetConfig {
  /**
   * Gets the ordered `<packageSources>` operations.
   */
  readonly operations: readonly SourceOperation[];

  /**
   * Gets the credentials keyed by normalised source name.
   */
  readonly credentials: Readonly<Record<string, SourceCredential>>;
}

/**
 * Interpolates `%VAR%` environment references in a value, leaving an unset variable as an empty string.
 * @param value The raw value.
 * @param env The environment to resolve references from.
 * @returns Returns the interpolated value.
 */
function interpolate(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/%([^%]+)%/g, (_match: string, name: string): string => env[name] ?? '');
}

/**
 * Reads a double-quoted XML attribute from a tag's attribute text, case-insensitively on the name.
 * @param attributes The attribute text.
 * @param name The attribute name.
 * @returns Returns the value, or null when absent.
 */
function attribute(attributes: string, name: string): string | null {
  const match: RegExpExecArray | null = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(
    attributes,
  );
  return match === null ? null : match[1];
}

/**
 * Normalises a source name for keyed lookup: decodes the `_x0020_` space escaping used in the
 * credentials section's element names, and lower-cases it.
 * @param name The raw source name.
 * @returns Returns the normalised name.
 */
export function normaliseSourceName(name: string): string {
  return name
    .replace(/_x0020_/gi, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extracts the inner content of the first named XML element, or null when it is absent.
 * @param xml The document.
 * @param element The element name.
 * @returns Returns the inner content, or null.
 */
function section(xml: string, element: string): string | null {
  const match: RegExpExecArray | null = new RegExp(
    `<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`,
    'i',
  ).exec(xml);
  return match === null ? null : match[1];
}

/**
 * Parses a `nuget.config` into its ordered source operations and credentials, with `%ENV%` references
 * interpolated. Absent sections yield empty results.
 * @param xml The `nuget.config` contents.
 * @param env The environment used to interpolate `%VAR%` references.
 * @returns Returns the parsed configuration.
 */
export function parseNuGetConfig(
  xml: string,
  env: Record<string, string | undefined>,
): NuGetConfig {
  return {
    operations: parseOperations(section(xml, 'packageSources')),
    credentials: parseCredentials(section(xml, 'packageSourceCredentials'), env),
  };
}

/**
 * Parses the ordered `<clear/>` and `<add>` operations from a `<packageSources>` section body.
 * @param body The section body, or null when absent.
 * @returns Returns the operations in document order.
 */
function parseOperations(body: string | null): readonly SourceOperation[] {
  if (body === null) {
    return [];
  }
  const operations: SourceOperation[] = [];
  for (const match of body.matchAll(/<(clear|add)\b([^>]*?)\/?>/gi)) {
    if (match[1].toLowerCase() === 'clear') {
      operations.push({ kind: 'clear' });
      continue;
    }
    const name: string | null = attribute(match[2], 'key');
    const url: string | null = attribute(match[2], 'value');
    if (name !== null && name.length > 0 && url !== null && url.length > 0) {
      operations.push({ kind: 'add', name, url });
    }
  }
  return operations;
}

/**
 * Parses the `<packageSourceCredentials>` section into credentials keyed by normalised source name.
 * Each child element names a source; its `Username` and cleartext password/token `<add>` entries are
 * read (encrypted passwords are ignored).
 * @param body The section body, or null when absent.
 * @param env The environment used to interpolate `%VAR%` references.
 * @returns Returns the credentials keyed by normalised source name.
 */
function parseCredentials(
  body: string | null,
  env: Record<string, string | undefined>,
): Readonly<Record<string, SourceCredential>> {
  if (body === null) {
    return {};
  }
  const credentials: Record<string, SourceCredential> = {};
  for (const source of body.matchAll(/<([A-Za-z0-9._-]+)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const name: string = normaliseSourceName(source[1]);
    let username: string | undefined;
    let password: string | undefined;
    for (const entry of source[2].matchAll(/<add\b([^>]*?)\/?>/gi)) {
      const key: string | null = attribute(entry[1], 'key');
      const value: string | null = attribute(entry[1], 'value');
      if (key === null || value === null) {
        continue;
      }
      if (key.toLowerCase() === 'username') {
        username = interpolate(value, env);
      } else if (key.toLowerCase() === 'cleartextpassword') {
        password = interpolate(value, env);
      }
    }
    if (username !== undefined || password !== undefined) {
      credentials[name] = { username, password };
    }
  }
  return credentials;
}
