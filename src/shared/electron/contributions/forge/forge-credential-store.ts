// The forge credential store: a personal access token per forge host, held in an encrypted blob owned
// by the main process. This module is the pure logic (blob parsing, token resolution order), kept free
// of Electron and Node imports so it is unit-testable with an in-memory blob and injected probes; the
// ForgeContribution is the thin shell that wires the ports to Electron's secure storage and the `gh`
// CLI.
//
// Deliberately a sibling of the AI CredentialStore rather than a generalisation of it: that one is
// typed to AiAuthKind and resolves through the AI auth strategies, and bending it to serve both would
// couple two capabilities that have nothing to say to each other.
//
// The token never leaves the main process. Only ForgeAuthStatus crosses to the renderer, and it carries
// provenance and identity — never the secret.

import { ForgeTokenSource } from '@shared/api/forge-types';

/**
 * Determines whether a value is a flat record of string values (the parsed token map).
 * @param value The value to test.
 * @returns Returns true when the value is a string-to-string record.
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry: unknown): boolean => typeof entry === 'string')
  );
}

/**
 * Parses the decrypted blob into a host-to-token map. An empty, absent or unparseable blob yields an
 * empty map rather than throwing: a corrupt credential file must leave the user signed out and able to
 * paste a new token, not unable to open settings.
 * @param plaintext The decrypted blob, or null when none is stored.
 * @returns Returns the token map.
 */
export function parseTokenMap(plaintext: string | null): Record<string, string> {
  if (plaintext === null || plaintext.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(plaintext);
    return isStringRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

/**
 * Serialises a token map to the blob written to disk.
 * @param map The token map.
 * @returns Returns the serialised blob.
 */
export function serializeTokenMap(map: Record<string, string>): string {
  return JSON.stringify(map);
}

/**
 * The persistence and environment primitives the {@link ForgeCredentialStore} depends on. The shell
 * injects a safe-storage-backed blob load/save and the `gh` CLI probe; tests inject in-memory fakes.
 */
export interface ForgeCredentialStorePorts {
  /**
   * Loads the decrypted token blob, or null when none is stored.
   * @returns Returns the decrypted blob, or null.
   */
  load(): string | null;

  /**
   * Persists the token blob, or clears it when passed null.
   * @param plaintext The blob to encrypt and store, or null to clear.
   */
  save(plaintext: string | null): void;

  /**
   * Reads the token the `gh` CLI holds for a host, or null when the CLI is absent or not logged in.
   * @param host The forge host.
   * @returns Returns the CLI's token, or null.
   */
  ghToken(host: string): string | null;
}

/**
 * The resolved credential and where it came from.
 */
export interface ResolvedToken {
  /**
   * Gets the token, or null when none resolved.
   */
  readonly token: string | null;

  /**
   * Gets where the token came from.
   */
  readonly source: ForgeTokenSource;
}

/**
 * Holds a personal access token per forge host and resolves which credential to use.
 *
 * **Resolution order is stored-token first, `gh` CLI second, and nothing else.** A token pasted into
 * Studio is an explicit act and must win over an ambient one. The environment is deliberately not
 * consulted: a stale `GITHUB_TOKEN` is a common state on a developer machine and `gh` itself prefers it
 * over a real login, reporting the invalid token rather than falling back — reproducing that here would
 * import the same trap. Studio reads `gh`'s *resolved* token through the CLI instead, and only when
 * nothing is stored.
 */
export class ForgeCredentialStore {
  /**
   * Holds the persistence and environment primitives.
   */
  private readonly ports: ForgeCredentialStorePorts;

  /**
   * Initializes a new instance of the {@link ForgeCredentialStore} class.
   * @param ports The persistence and environment primitives.
   */
  public constructor(ports: ForgeCredentialStorePorts) {
    this.ports = ports;
  }

  /**
   * Determines whether a token is stored for a host. This is what the settings page's Clear action
   * acts on, and is true even when the stored token turns out to be rejected by the forge.
   * @param host The forge host.
   * @returns Returns true when a token is stored.
   */
  public hasStoredToken(host: string): boolean {
    const stored: string | undefined = this.map()[host];
    return stored !== undefined && stored.length > 0;
  }

  /**
   * Stores a token for a host. A blank token clears the entry instead of storing an empty secret, so
   * emptying the settings field is the same act as clearing it.
   * @param host The forge host.
   * @param token The token to store.
   */
  public setToken(host: string, token: string): void {
    const trimmed: string = token.trim();
    if (trimmed.length === 0) {
      this.clearToken(host);
      return;
    }
    this.write({ ...this.map(), [host]: trimmed });
  }

  /**
   * Clears the stored token for a host. The `gh` CLI fallback is untouched, so clearing may leave the
   * user still authenticated — which the returned status then says.
   * @param host The forge host.
   */
  public clearToken(host: string): void {
    const map: Record<string, string> = this.map();
    if (!(host in map)) {
      return;
    }
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(map)) {
      if (key !== host) {
        next[key] = value;
      }
    }
    this.write(next);
  }

  /**
   * Resolves the credential to authenticate a host with.
   * @param host The forge host.
   * @returns Returns the token and its provenance; the token is null when none resolved.
   */
  public resolve(host: string): ResolvedToken {
    const stored: string | undefined = this.map()[host];
    if (stored !== undefined && stored.length > 0) {
      return { token: stored, source: 'stored' };
    }
    const cli: string | null = this.ports.ghToken(host);
    if (cli !== null && cli.length > 0) {
      return { token: cli, source: 'gh-cli' };
    }
    return { token: null, source: 'none' };
  }

  /**
   * Reads the current token map.
   * @returns Returns the token map.
   */
  private map(): Record<string, string> {
    return parseTokenMap(this.ports.load());
  }

  /**
   * Writes a token map, clearing the blob entirely when it holds nothing — so signing out leaves no
   * credential file behind rather than an encrypted empty object.
   * @param map The map to write.
   */
  private write(map: Record<string, string>): void {
    this.ports.save(Object.keys(map).length === 0 ? null : serializeTokenMap(map));
  }
}
