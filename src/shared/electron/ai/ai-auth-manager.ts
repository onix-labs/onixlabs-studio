import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { app, ipcMain, IpcMainInvokeEvent, safeStorage } from 'electron';
import type { AiAuthSource, AiAuthStatus } from '@shared/ai-types';
import { AiChannel } from '@shared/api/ai-channels';

/**
 * A resolved credential for running an agent turn. The API key, when present, never leaves the main
 * process — it is read here and handed directly to the agent SDK.
 */
export interface AiCredential {
  /**
   * Gets the credential source.
   */
  readonly source: AiAuthSource;

  /**
   * Gets the API key to authenticate with, or null when the source is the local login (which
   * authenticates from `~/.claude`) or when no credential is available.
   */
  readonly apiKey: string | null;
}

/**
 * Owns the agent's Anthropic credentials in the main process. It prefers the user's **local Claude
 * login** (`~/.claude`, the same credential Claude Code uses) and falls back to a user-supplied API
 * key stored encrypted at rest (via the OS secure-storage facility), then to `ANTHROPIC_API_KEY` for
 * development. The key is never exposed to the renderer; only status, configuration, and the resolved
 * credential (used internally) cross any boundary.
 */
export class AiAuthManager {
  /**
   * Holds the absolute path of the encrypted API-key file in the app's user-data directory.
   */
  private readonly keyFile: string = join(app.getPath('userData'), 'ai-credentials.bin');

  /**
   * Reports whether the user has a local Claude login.
   * @returns Returns true when `~/.claude` exists.
   */
  public hasLocalLogin(): boolean {
    return existsSync(join(homedir(), '.claude'));
  }

  /**
   * Resolves the API key available to providers (a stored key, then the development environment key),
   * independent of the local-login precedence used for {@link getStatus}.
   * @returns Returns the API key, or null when none is available.
   */
  public apiKey(): string | null {
    return this.readStoredKey() ?? this.envKey();
  }

  /**
   * Reads and decrypts the stored API key, if any.
   * @returns Returns the stored key, or null when none is stored or it cannot be decrypted.
   */
  private readStoredKey(): string | null {
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
   * Reads the development-only `ANTHROPIC_API_KEY` environment variable.
   * @returns Returns the environment key, or null when it is unset or empty.
   */
  private envKey(): string | null {
    const key: string | undefined = process.env['ANTHROPIC_API_KEY'];
    return typeof key === 'string' && key.length > 0 ? key : null;
  }

  /**
   * Gets the current authentication status, safe to surface in the UI (never includes the key).
   * @returns Returns the resolved {@link AiAuthStatus}.
   */
  public getStatus(): AiAuthStatus {
    const hasStoredKey: boolean = this.readStoredKey() !== null;
    if (this.hasLocalLogin()) {
      return {
        source: 'local-login',
        available: true,
        hasStoredKey,
        detail: 'Using your local Claude login (~/.claude).',
      };
    }
    if (hasStoredKey) {
      return {
        source: 'api-key',
        available: true,
        hasStoredKey: true,
        detail: 'Using your stored Anthropic API key.',
      };
    }
    if (this.envKey() !== null) {
      return {
        source: 'api-key',
        available: true,
        hasStoredKey: false,
        detail: 'Using ANTHROPIC_API_KEY from the environment.',
      };
    }
    return {
      source: 'none',
      available: false,
      hasStoredKey: false,
      detail: 'Run `claude` to log in, or add an Anthropic API key.',
    };
  }

  /**
   * Resolves the credential an agent run should authenticate with, applying the local-login → stored
   * key → environment key → none precedence.
   * @returns Returns the resolved {@link AiCredential}.
   */
  public resolveCredential(): AiCredential {
    if (this.hasLocalLogin()) {
      return { source: 'local-login', apiKey: null };
    }
    const key: string | null = this.readStoredKey() ?? this.envKey();
    return key !== null ? { source: 'api-key', apiKey: key } : { source: 'none', apiKey: null };
  }

  /**
   * Stores a user-supplied API key, encrypted at rest. An empty key clears any stored key instead.
   * @param key The Anthropic API key to store.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  public setApiKey(key: string): AiAuthStatus {
    const trimmed: string = key.trim();
    if (trimmed.length === 0) {
      return this.clearApiKey();
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system secure storage is unavailable; cannot store the API key.');
    }
    mkdirSync(dirname(this.keyFile), { recursive: true });
    writeFileSync(this.keyFile, safeStorage.encryptString(trimmed), { mode: 0o600 });
    return this.getStatus();
  }

  /**
   * Clears any stored API key.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  public clearApiKey(): AiAuthStatus {
    if (existsSync(this.keyFile)) {
      rmSync(this.keyFile);
    }
    return this.getStatus();
  }

  /**
   * Registers the IPC handlers for the renderer's auth status and key-management requests.
   */
  public register(): void {
    ipcMain.handle(AiChannel.AuthStatus, (): AiAuthStatus => this.getStatus());
    ipcMain.handle(
      AiChannel.SetApiKey,
      (_event: IpcMainInvokeEvent, key: unknown): AiAuthStatus =>
        typeof key === 'string' ? this.setApiKey(key) : this.getStatus(),
    );
    ipcMain.handle(AiChannel.ClearApiKey, (): AiAuthStatus => this.clearApiKey());
  }
}
