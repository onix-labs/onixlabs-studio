import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { app, ipcMain, IpcMainInvokeEvent, safeStorage } from 'electron';
import type {
  AiAuthKind,
  AiAuthStatus,
  AiConnectionAuthRequest,
  AiSetConnectionKeyRequest,
} from '@shared/api/ai-types';
import { AiChannel } from '@shared/api/ai-channels';
import type { AgentAuth } from './agent-provider';
import { CredentialStore, type CredentialStorePorts } from './credential-store';
import type { AiCredential } from './auth-strategies';

export type { AiCredential };

/**
 * The auth kinds a connection can use, for validating IPC requests before they reach the store.
 */
const AUTH_KINDS: readonly string[] = ['api-key', 'none', 'claude-login'];

/**
 * The status returned when a keyed auth request arrives malformed (it never should from the renderer).
 */
const INVALID_REQUEST_STATUS: AiAuthStatus = {
  source: 'none',
  available: false,
  hasStoredKey: false,
  detail: 'Invalid authentication request.',
};

/**
 * Owns the agent's credentials in the main process. It keeps a per-connection API key encrypted at rest
 * (via the OS secure-storage facility) and resolves each connection's credential through the auth
 * strategies, preferring the user's **local Claude login** (`~/.claude`) and falling back to
 * `ANTHROPIC_API_KEY` for development where the strategy allows. Keys are never exposed to the renderer;
 * only status, configuration, and the resolved credential (used internally) cross any boundary.
 *
 * This class is a thin Electron shell: the storage and environment primitives are wired into a pure
 * {@link CredentialStore}, which holds all the logic. The pre-connections single-key API
 * ({@link getStatus}, {@link setApiKey}, {@link clearApiKey}, {@link resolveCredential}, {@link apiKey})
 * is preserved and now backed by the store's legacy credential slot, so the existing runtime and UI are
 * unchanged while connections are wired up.
 */
export class AiAuthManager {
  /**
   * Holds the absolute path of the encrypted credential file in the app's user-data directory.
   */
  private readonly keyFile: string = join(app.getPath('userData'), 'ai-credentials.bin');

  /**
   * Holds the pure credential store, wired to this shell's storage and environment primitives.
   */
  private readonly store: CredentialStore = new CredentialStore(this.ports());

  /**
   * Reports whether the user has a local Claude login.
   * @returns Returns true when `~/.claude` exists.
   */
  public hasLocalLogin(): boolean {
    return existsSync(join(homedir(), '.claude'));
  }

  /**
   * Resolves the API key available to providers (the legacy global stored key, then the development
   * environment key), independent of the local-login precedence used for {@link getStatus}.
   * @returns Returns the API key, or null when none is available.
   */
  public apiKey(): string | null {
    return this.store.legacyApiKey();
  }

  /**
   * Gets the current authentication status, safe to surface in the UI (never includes the key).
   * @returns Returns the resolved {@link AiAuthStatus}.
   */
  public getStatus(): AiAuthStatus {
    return this.store.legacyStatus();
  }

  /**
   * Resolves the credential an agent run should authenticate with, applying the local-login → stored
   * key → environment key → none precedence.
   * @returns Returns the resolved credential.
   */
  public resolveCredential(): AiCredential {
    return this.store.legacyResolve();
  }

  /**
   * Stores a user-supplied API key, encrypted at rest. An empty key clears any stored key instead.
   * @param key The Anthropic API key to store.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  public setApiKey(key: string): AiAuthStatus {
    return this.store.setLegacyKey(key);
  }

  /**
   * Clears any stored API key.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  public clearApiKey(): AiAuthStatus {
    return this.store.clearLegacyKey();
  }

  /**
   * Gets the authentication status of a connection under its auth kind (never carries the key).
   * @param connectionId The connection id.
   * @param authKind The connection's auth kind.
   * @returns Returns the status.
   */
  public statusFor(connectionId: string, authKind: AiAuthKind): AiAuthStatus {
    return this.store.statusFor(connectionId, authKind);
  }

  /**
   * Resolves a connection's credential into the {@link AgentAuth} shape the adapters consume.
   * @param connectionId The connection id.
   * @param authKind The connection's auth kind.
   * @returns Returns the agent auth.
   */
  public authFor(connectionId: string, authKind: AiAuthKind): AgentAuth {
    return this.store.authFor(connectionId, authKind);
  }

  /**
   * Stores a connection's API key (a blank key clears it) and returns the connection's updated status.
   * @param connectionId The connection id.
   * @param authKind The connection's auth kind.
   * @param key The API key to store.
   * @returns Returns the connection's updated status.
   */
  public setConnectionKey(connectionId: string, authKind: AiAuthKind, key: string): AiAuthStatus {
    this.store.setKey(connectionId, key);
    return this.store.statusFor(connectionId, authKind);
  }

  /**
   * Clears a connection's stored API key and returns the connection's updated status.
   * @param connectionId The connection id.
   * @param authKind The connection's auth kind.
   * @returns Returns the connection's updated status.
   */
  public clearConnectionKey(connectionId: string, authKind: AiAuthKind): AiAuthStatus {
    this.store.clearKey(connectionId);
    return this.store.statusFor(connectionId, authKind);
  }

  /**
   * Registers the IPC handlers for the renderer's auth status and key-management requests (both the
   * legacy global-key channels and the per-connection channels).
   */
  public register(): void {
    ipcMain.handle(AiChannel.AuthStatus, (): AiAuthStatus => this.getStatus());
    ipcMain.handle(
      AiChannel.SetApiKey,
      (_event: IpcMainInvokeEvent, key: unknown): AiAuthStatus =>
        typeof key === 'string' ? this.setApiKey(key) : this.getStatus(),
    );
    ipcMain.handle(AiChannel.ClearApiKey, (): AiAuthStatus => this.clearApiKey());
    ipcMain.handle(
      AiChannel.ConnectionAuthStatus,
      (_event: IpcMainInvokeEvent, request: unknown): AiAuthStatus =>
        this.isConnectionAuthRequest(request)
          ? this.statusFor(request.connectionId, request.authKind)
          : INVALID_REQUEST_STATUS,
    );
    ipcMain.handle(
      AiChannel.SetConnectionKey,
      (_event: IpcMainInvokeEvent, request: unknown): AiAuthStatus =>
        this.isSetConnectionKeyRequest(request)
          ? this.setConnectionKey(request.connectionId, request.authKind, request.key)
          : INVALID_REQUEST_STATUS,
    );
    ipcMain.handle(
      AiChannel.ClearConnectionKey,
      (_event: IpcMainInvokeEvent, request: unknown): AiAuthStatus =>
        this.isConnectionAuthRequest(request)
          ? this.clearConnectionKey(request.connectionId, request.authKind)
          : INVALID_REQUEST_STATUS,
    );
  }

  /**
   * Builds the store's persistence and environment primitives from this shell's Electron facilities.
   * @returns Returns the ports.
   */
  private ports(): CredentialStorePorts {
    return {
      load: (): string | null => this.loadBlob(),
      save: (plaintext: string | null): void => this.saveBlob(plaintext),
      hasLocalLogin: (): boolean => this.hasLocalLogin(),
      envKey: (): string | null => this.envKey(),
    };
  }

  /**
   * Reads the development-only `ANTHROPIC_API_KEY` environment variable.
   * @returns Returns the environment key, or null when it is unset or empty.
   */
  private envKey(): string | null {
    const key: string | undefined = process.env['ANTHROPIC_API_KEY'];
    return typeof key === 'string' && key.length > 0 ? key : null;
  }

  /**
   * Reads and decrypts the stored credential blob, if any.
   * @returns Returns the decrypted blob, or null when none is stored or it cannot be decrypted.
   */
  private loadBlob(): string | null {
    if (!existsSync(this.keyFile) || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      const decrypted: string = safeStorage.decryptString(readFileSync(this.keyFile));
      return decrypted.length > 0 ? decrypted : null;
    } catch {
      return null;
    }
  }

  /**
   * Encrypts and writes the credential blob, or removes the file when passed null.
   * @param plaintext The blob to store, or null to clear.
   */
  private saveBlob(plaintext: string | null): void {
    if (plaintext === null) {
      if (existsSync(this.keyFile)) {
        rmSync(this.keyFile);
      }
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system secure storage is unavailable; cannot store the API key.');
    }
    mkdirSync(dirname(this.keyFile), { recursive: true });
    writeFileSync(this.keyFile, safeStorage.encryptString(plaintext), { mode: 0o600 });
  }

  /**
   * Determines whether a value is a well-formed connection auth request.
   * @param value The value to test.
   * @returns Returns true when the value is a connection auth request.
   */
  private isConnectionAuthRequest(value: unknown): value is AiConnectionAuthRequest {
    return (
      typeof value === 'object' &&
      value !== null &&
      'connectionId' in value &&
      typeof value.connectionId === 'string' &&
      'authKind' in value &&
      typeof value.authKind === 'string' &&
      AUTH_KINDS.includes(value.authKind)
    );
  }

  /**
   * Determines whether a value is a well-formed set-connection-key request.
   * @param value The value to test.
   * @returns Returns true when the value is a set-connection-key request.
   */
  private isSetConnectionKeyRequest(value: unknown): value is AiSetConnectionKeyRequest {
    return this.isConnectionAuthRequest(value) && 'key' in value && typeof value.key === 'string';
  }
}
