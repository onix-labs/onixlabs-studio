// The registry tokens a user saves in Studio for package-manager plugins (#907, #911): the second
// route to a credential, after the tool's own configuration (`.npmrc`, `nuget.config`) that the plugin
// reads itself. This module is the pure logic, kept free of Electron so it is testable with an
// in-memory blob; `createPackageRegistryTokens` wires it to Electron's secure storage.
//
// ⛔ A token is keyed by the plugin AND the registry. It is handed only to that plugin, only when the
// plugin asks for that registry mid-request, and never crosses to the renderer: Settings sees which
// registries have one, not what it is.

import type { PackageRegistryToken } from '@shared/api/package-channels';
import type { HostingCredentialStorePorts } from '../hosting/hosting-credential-store';
import { parseTokenMap, serializeTokenMap } from '../hosting/hosting-credential-store';

/**
 * Separates the plugin from the registry in a stored key. A newline can appear in neither: a plugin id
 * is validated by the manifest, and a registry is a normalised URL.
 */
const KEY_SEPARATOR: string = '\n';

/**
 * Normalises a registry: an https URL, without credentials, query or fragment, and without a trailing
 * slash, so one registry is one key however it was written. The host applies the same rule to what a
 * plugin asks for, so a token saved here is found when it is asked for.
 * @param registry The registry, as written.
 * @returns Returns the normalised URL, or null when it is not an https URL.
 */
export function normaliseRegistry(registry: string): string | null {
  let url: URL;
  try {
    url = new URL(registry.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) {
    return null;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Holds the registry tokens saved in Studio, per plugin and registry, encrypted at rest by the ports.
 */
export class PackageRegistryTokenStore {
  /**
   * Holds the persistence primitives.
   */
  private readonly ports: HostingCredentialStorePorts;

  /**
   * Initializes a new instance of the {@link PackageRegistryTokenStore} class.
   * @param ports The persistence primitives.
   */
  public constructor(ports: HostingCredentialStorePorts) {
    this.ports = ports;
  }

  /**
   * Lists the registries a token is saved for, never the tokens.
   * @returns Returns the saved registries, ordered by plugin then registry.
   */
  public list(): readonly PackageRegistryToken[] {
    return Object.keys(this.map())
      .map((key: string): PackageRegistryToken | null => splitKey(key))
      .filter((entry: PackageRegistryToken | null): entry is PackageRegistryToken => entry !== null)
      .sort(
        (a: PackageRegistryToken, b: PackageRegistryToken): number =>
          a.pluginId.localeCompare(b.pluginId) || a.registry.localeCompare(b.registry),
      );
  }

  /**
   * Saves a token for a plugin and a registry. A blank token clears the entry instead.
   * @param pluginId The plugin the token is for.
   * @param registry The registry, as the user wrote it.
   * @param token The token.
   * @returns Returns the reason it was refused, or null when it was saved.
   */
  public save(pluginId: string, registry: string, token: string): string | null {
    const normalised: string | null = normaliseRegistry(registry);
    if (normalised === null) {
      return 'The registry must be an https address, without a user name or password in it.';
    }
    const trimmed: string = token.trim();
    if (trimmed.length === 0) {
      this.clear(pluginId, normalised);
      return null;
    }
    this.write({ ...this.map(), [keyOf(pluginId, normalised)]: trimmed });
    return null;
  }

  /**
   * Forgets the token saved for a plugin and a registry.
   * @param pluginId The plugin.
   * @param registry The registry.
   */
  public clear(pluginId: string, registry: string): void {
    const normalised: string | null = normaliseRegistry(registry);
    if (normalised === null) {
      return;
    }
    const key: string = keyOf(pluginId, normalised);
    const map: Record<string, string> = this.map();
    if (!(key in map)) {
      return;
    }
    const next: Record<string, string> = {};
    for (const [entry, value] of Object.entries(map)) {
      if (entry !== key) {
        next[entry] = value;
      }
    }
    this.write(next);
  }

  /**
   * Reads the token saved for a plugin and a registry.
   * @param pluginId The plugin asking.
   * @param registry The registry, already normalised by the host.
   * @returns Returns the token, or null when none is saved for exactly that pair.
   */
  public token(pluginId: string, registry: string): string | null {
    const stored: string | undefined = this.map()[keyOf(pluginId, registry)];
    return stored !== undefined && stored.length > 0 ? stored : null;
  }

  /**
   * Reads the stored map.
   * @returns Returns the map, empty when nothing is stored or it cannot be read.
   */
  private map(): Record<string, string> {
    return parseTokenMap(this.ports.load());
  }

  /**
   * Writes the map, clearing the blob entirely when it holds nothing.
   * @param map The map to write.
   */
  private write(map: Record<string, string>): void {
    this.ports.save(Object.keys(map).length === 0 ? null : serializeTokenMap(map));
  }
}

/**
 * Builds the stored key for a plugin and a registry.
 * @param pluginId The plugin.
 * @param registry The normalised registry.
 * @returns Returns the key.
 */
function keyOf(pluginId: string, registry: string): string {
  return `${pluginId}${KEY_SEPARATOR}${registry}`;
}

/**
 * Splits a stored key back into its plugin and registry.
 * @param key The stored key.
 * @returns Returns the pair, or null when the key is not one this store wrote.
 */
function splitKey(key: string): PackageRegistryToken | null {
  const at: number = key.indexOf(KEY_SEPARATOR);
  if (at <= 0 || at === key.length - 1) {
    return null;
  }
  return { pluginId: key.slice(0, at), registry: key.slice(at + 1) };
}
