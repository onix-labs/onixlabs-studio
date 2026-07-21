// The per-connection credential store. It holds an API key per connection id, encrypted at rest by the
// main-process shell that owns it; this module is the pure logic (map parsing, the legacy-format
// migration, and credential/status resolution through the auth strategies), kept free of Electron and
// Node imports so it is unit-testable with an in-memory blob and injected filesystem checks.
//
// Persistence is a single encrypted blob holding a JSON map of connection id -> API key. A blob written
// by the pre-connections app was a single raw Anthropic key string; {@link parseCredentialMap} migrates
// that forward onto the built-in Anthropic API-key connection, so an upgrading user's stored key keeps
// authenticating that connection.

import { ANTHROPIC_KEY_CONNECTION_ID } from '@shared/api/ai-types';
import type { AiAuthKind, AiAuthStatus } from '@shared/api/ai-types';
import type { AgentAuth } from './agent-provider';
import { type AiCredential, type AuthContext, strategyFor } from './auth-strategies';

/**
 * Determines whether a value is a flat record of string values (the parsed credential map).
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
 * Parses the decrypted credential blob into a connection-id-to-key map, migrating the legacy raw-key
 * format forward. An empty or absent blob yields an empty map; a JSON object is used directly; anything
 * else (a bare Anthropic key string written by the pre-connections app) is migrated onto the built-in
 * Anthropic API-key connection, so it authenticates that connection after the upgrade.
 * @param plaintext The decrypted blob, or null when none is stored.
 * @returns Returns the credential map.
 */
export function parseCredentialMap(plaintext: string | null): Record<string, string> {
  if (plaintext === null || plaintext.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (isStringRecord(parsed)) {
      return { ...parsed };
    }
  } catch {
    // Not JSON — a legacy single raw key. Fall through to migrate it.
  }
  return { [ANTHROPIC_KEY_CONNECTION_ID]: plaintext };
}

/**
 * Serialises a credential map to the blob written to disk.
 * @param map The credential map.
 * @returns Returns the serialised blob.
 */
export function serializeCredentialMap(map: Record<string, string>): string {
  return JSON.stringify(map);
}

/**
 * Returns a copy of the map with a key set for a connection id.
 * @param map The credential map.
 * @param id The connection id.
 * @param key The API key.
 * @returns Returns the updated map.
 */
export function setKeyIn(
  map: Record<string, string>,
  id: string,
  key: string,
): Record<string, string> {
  return { ...map, [id]: key };
}

/**
 * Returns a copy of the map without the key for a connection id.
 * @param map The credential map.
 * @param id The connection id.
 * @returns Returns the updated map.
 */
export function removeKeyFrom(map: Record<string, string>, id: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key !== id) {
      next[key] = value;
    }
  }
  return next;
}

/**
 * The persistence and environment primitives the {@link CredentialStore} depends on. The shell injects
 * a safe-storage-backed blob load/save and the filesystem-backed login/environment checks; tests inject
 * in-memory fakes.
 */
export interface CredentialStorePorts {
  /**
   * Loads the decrypted credential blob, or null when none is stored.
   * @returns Returns the decrypted blob, or null.
   */
  load(): string | null;

  /**
   * Persists the credential blob, or clears it when passed null.
   * @param plaintext The blob to encrypt and store, or null to clear.
   */
  save(plaintext: string | null): void;

  /**
   * Reports whether a local Claude login (`~/.claude`) is present.
   * @returns Returns true when a local login is present.
   */
  hasLocalLogin(): boolean;

  /**
   * Reports whether a local Codex login (`~/.codex`) is present.
   * @returns Returns true when a local Codex login is present.
   */
  hasCodexLogin(): boolean;

  /**
   * Reads the development-only `ANTHROPIC_API_KEY` environment key, or null when unset.
   * @returns Returns the environment key, or null.
   */
  envKey(): string | null;
}

/**
 * The keyed credential store: a per-connection API key held in an encrypted blob, resolved to
 * credentials and status through the auth strategies. All logic lives here (pure but for the injected
 * ports); the main-process {@link import('./ai-auth-manager').AiAuthManager} is a thin shell that wires
 * the ports to Electron's secure storage and the filesystem.
 */
export class CredentialStore {
  /**
   * Holds the persistence and environment primitives.
   */
  private readonly ports: CredentialStorePorts;

  /**
   * Initialises a new instance of the {@link CredentialStore} class.
   * @param ports The persistence and environment primitives.
   */
  public constructor(ports: CredentialStorePorts) {
    this.ports = ports;
  }

  /**
   * Reads the current credential map.
   * @returns Returns the credential map.
   */
  private map(): Record<string, string> {
    return parseCredentialMap(this.ports.load());
  }

  /**
   * Persists a credential map, clearing the store when it is empty.
   * @param map The map to persist.
   */
  private persist(map: Record<string, string>): void {
    this.ports.save(Object.keys(map).length > 0 ? serializeCredentialMap(map) : null);
  }

  /**
   * Gets the API key stored for a connection, or null when none is stored.
   * @param id The connection id.
   * @returns Returns the stored key, or null.
   */
  public storedKeyFor(id: string): string | null {
    return this.map()[id] ?? null;
  }

  /**
   * Stores an API key for a connection, encrypting it at rest. A blank key clears any stored key.
   * @param id The connection id.
   * @param key The API key to store.
   */
  public setKey(id: string, key: string): void {
    const trimmed: string = key.trim();
    if (trimmed.length === 0) {
      this.clearKey(id);
      return;
    }
    this.persist(setKeyIn(this.map(), id, trimmed));
  }

  /**
   * Clears any API key stored for a connection.
   * @param id The connection id.
   */
  public clearKey(id: string): void {
    const map: Record<string, string> = this.map();
    if (id in map) {
      this.persist(removeKeyFrom(map, id));
    }
  }

  /**
   * Builds the resolution context for a connection id.
   * @param id The connection id.
   * @returns Returns the auth context.
   */
  private context(id: string): AuthContext {
    return {
      storedKey: this.storedKeyFor(id),
      hasLocalLogin: this.ports.hasLocalLogin(),
      hasCodexLogin: this.ports.hasCodexLogin(),
      envKey: this.ports.envKey(),
    };
  }

  /**
   * Gets the UI-safe status for a connection under an auth kind (never carries the key).
   * @param id The connection id.
   * @param kind The connection's auth kind.
   * @returns Returns the status.
   */
  public statusFor(id: string, kind: AiAuthKind): AiAuthStatus {
    return strategyFor(kind).status(this.context(id));
  }

  /**
   * Resolves the credential a run authenticates a connection with.
   * @param id The connection id.
   * @param kind The connection's auth kind.
   * @returns Returns the resolved credential.
   */
  public resolveCredentialFor(id: string, kind: AiAuthKind): AiCredential {
    return strategyFor(kind).resolve(this.context(id));
  }

  /**
   * Resolves a connection's credential into the {@link AgentAuth} shape the adapters consume.
   * @param id The connection id.
   * @param kind The connection's auth kind.
   * @returns Returns the agent auth.
   */
  public authFor(id: string, kind: AiAuthKind): AgentAuth {
    return {
      hasLocalLogin: this.ports.hasLocalLogin(),
      hasCodexLogin: this.ports.hasCodexLogin(),
      apiKey: this.resolveCredentialFor(id, kind).apiKey,
    };
  }
}
