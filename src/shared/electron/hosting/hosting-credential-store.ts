// The hosting credential store: a token per host, held in an encrypted blob owned by the main process —
// the "login Studio provides" a hosting plugin is handed when the user chooses it (#819). This module is
// the pure logic (blob parsing), kept free of Electron and Node imports so it is unit-testable with an
// in-memory blob; `createHostingCredentialStore` wires the ports to Electron's secure storage.
//
// The host's CLI login is not consulted here. That is the plugin's business — core used to run
// `gh auth token` itself, which made it know about GitHub's CLI (#820).
//
// Deliberately a sibling of the AI CredentialStore rather than a generalisation of it: that one is
// typed to AiAuthKind and resolves through the AI auth strategies, and bending it to serve both would
// couple two capabilities that have nothing to say to each other.
//
// The token leaves the main process only to the hosting plugin that serves its host, when that plugin
// asks. Only ForgeAuthStatus crosses to the renderer, and it carries provenance and identity — never the
// secret.

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
 * The persistence primitives the {@link HostingCredentialStore} depends on. The shell injects a
 * safe-storage-backed blob load/save; tests inject in-memory fakes.
 */
export interface HostingCredentialStorePorts {
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
}

/**
 * Holds the token Studio keeps for each host. The environment is deliberately never consulted: a stale
 * `GITHUB_TOKEN` is a common state on a developer machine, and authenticating as it would be a trap.
 */
export class HostingCredentialStore {
  /**
   * Holds the persistence primitives.
   */
  private readonly ports: HostingCredentialStorePorts;

  /**
   * Initializes a new instance of the {@link HostingCredentialStore} class.
   * @param ports The persistence primitives.
   */
  public constructor(ports: HostingCredentialStorePorts) {
    this.ports = ports;
  }

  /**
   * Determines whether a token is stored for a host. This is what the settings page's Clear action
   * acts on, and is true even when the stored token turns out to be rejected by the forge.
   * @param host The host.
   * @returns Returns true when a token is stored.
   */
  public hasStoredToken(host: string): boolean {
    const stored: string | undefined = this.map()[host];
    return stored !== undefined && stored.length > 0;
  }

  /**
   * Stores a token for a host. A blank token clears the entry instead of storing an empty secret, so
   * emptying the settings field is the same act as clearing it.
   * @param host The host.
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
   * Clears the stored token for a host. The host's CLI login is untouched, so clearing may leave the
   * user still authenticated — which the returned status then says.
   * @param host The host.
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
   * Reads the token stored for a host.
   * @param host The host.
   * @returns Returns the token, or null when none is stored.
   */
  public token(host: string): string | null {
    const stored: string | undefined = this.map()[host];
    return stored !== undefined && stored.length > 0 ? stored : null;
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
