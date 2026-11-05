import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChannel } from '@shared/api/ai-channels';
import type { AiAuthStatus } from '@shared/api/ai-types';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the fake Electron layer. "Encryption" reverses the bytes, so a plaintext key can be seen not
 * to reach the disk.
 */
const electron: {
  handlers: Map<string, Handler>;
  userData: string;
  encryption: boolean;
  corrupt: boolean;
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  userData: '',
  encryption: true,
  corrupt: false,
}));

vi.mock('electron', () => ({
  app: { getPath: (): string => electron.userData },
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
  safeStorage: {
    isEncryptionAvailable: (): boolean => electron.encryption,
    encryptString: (text: string): Buffer => Buffer.from(text).reverse(),
    decryptString: (bytes: Buffer): string => {
      if (electron.corrupt) {
        throw new Error('Error while decrypting the ciphertext');
      }
      return Buffer.from(bytes).reverse().toString();
    },
  },
}));

const { AiAuthManager } = await import('./ai-auth-manager');

describe('AiAuthManager', () => {
  let manager: InstanceType<typeof AiAuthManager>;

  /**
   * Invokes a captured IPC handler.
   * @param channel The channel.
   * @param request The renderer-supplied request.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, request: unknown): Promise<T> {
    return (await electron.handlers.get(channel)?.({}, request)) as T;
  }

  /**
   * Gets the path of the encrypted credential file.
   * @returns Returns the path.
   */
  function keyFile(): string {
    return path.join(electron.userData, 'ai-credentials.bin');
  }

  beforeEach(() => {
    electron.userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-auth-')));
    electron.handlers.clear();
    electron.encryption = true;
    electron.corrupt = false;
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    manager = new AiAuthManager();
    manager.register();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(electron.userData, { recursive: true, force: true });
  });

  it('setKey_storesItEncrypted_andPrivately', async () => {
    await invoke(AiChannel.SetConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
      key: 'sk-1',
    });

    expect(fs.readFileSync(keyFile()).toString()).not.toContain('sk-1');
    expect(fs.statSync(keyFile()).mode & 0o777).toBe(0o600);
    expect(manager.authFor('c', 'api-key').apiKey).toBe('sk-1');
  });

  it('status_neverCarriesTheKey', async () => {
    const status: AiAuthStatus = await invoke(AiChannel.SetConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
      key: 'sk-secret',
    });

    expect(JSON.stringify(status)).not.toContain('sk-secret');
    expect(status.hasStoredKey).toBe(true);
  });

  it('keys_areKeptPerConnection', async () => {
    await invoke(AiChannel.SetConnectionKey, { connectionId: 'a', authKind: 'api-key', key: 'A' });
    await invoke(AiChannel.SetConnectionKey, { connectionId: 'b', authKind: 'api-key', key: 'B' });

    expect(manager.authFor('a', 'api-key').apiKey).toBe('A');
    expect(manager.authFor('b', 'api-key').apiKey).toBe('B');
  });

  it('keys_surviveARestart', async () => {
    await invoke(AiChannel.SetConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
      key: 'sk-1',
    });

    expect(new AiAuthManager().authFor('c', 'api-key').apiKey).toBe('sk-1');
  });

  it('clearKey_forgetsIt', async () => {
    await invoke(AiChannel.SetConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
      key: 'sk-1',
    });

    const status: AiAuthStatus = await invoke(AiChannel.ClearConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
    });

    expect(status.hasStoredKey).toBe(false);
    expect(manager.authFor('c', 'api-key').apiKey).toBeNull();
  });

  it('setKey_withABlankKey_clearsIt', async () => {
    await invoke(AiChannel.SetConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
      key: 'sk-1',
    });

    await invoke(AiChannel.SetConnectionKey, { connectionId: 'c', authKind: 'api-key', key: '' });

    expect(manager.authFor('c', 'api-key').apiKey).toBeNull();
  });

  it.each([
    [undefined],
    [null],
    ['c'],
    [{ connectionId: 7, authKind: 'api-key', key: 'x' }],
    [{ connectionId: 'c', authKind: 'made-up', key: 'x' }],
    [{ connectionId: 'c', key: 'x' }],
    [{ connectionId: 'c', authKind: 'api-key', key: 7 }],
    [{ connectionId: 'c', authKind: 'api-key' }],
  ])('setKey_withAMalformedRequest_storesNothing %#', async (request: unknown) => {
    const status: AiAuthStatus = await invoke(AiChannel.SetConnectionKey, request);

    expect(status.detail).toBe('Invalid authentication request.');
    expect(fs.existsSync(keyFile())).toBe(false);
  });

  it.each([[undefined], [{ connectionId: 'c', authKind: 'made-up' }]])(
    'statusAndClear_withAMalformedRequest_answerInvalid %#',
    async (request: unknown) => {
      const invalid: unknown = expect.objectContaining({
        detail: 'Invalid authentication request.',
      });

      expect(await invoke(AiChannel.ConnectionAuthStatus, request)).toEqual(invalid);
      expect(await invoke(AiChannel.ClearConnectionKey, request)).toEqual(invalid);
    },
  );

  it('setKey_withNoSecureStorage_refusesRatherThanStoringPlaintext', async () => {
    electron.encryption = false;

    await expect(
      invoke(AiChannel.SetConnectionKey, { connectionId: 'c', authKind: 'api-key', key: 'sk-1' }),
    ).rejects.toThrow('secure storage is unavailable');

    expect(fs.existsSync(keyFile())).toBe(false);
  });

  it('load_ofAnUndecryptableFile_treatsItAsNoKey', async () => {
    await invoke(AiChannel.SetConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
      key: 'sk-1',
    });
    electron.corrupt = true;

    expect(new AiAuthManager().authFor('c', 'api-key').apiKey).toBeNull();
  });

  it('load_withNoSecureStorage_treatsItAsNoKey', async () => {
    await invoke(AiChannel.SetConnectionKey, {
      connectionId: 'c',
      authKind: 'api-key',
      key: 'sk-1',
    });
    electron.encryption = false;

    expect(new AiAuthManager().authFor('c', 'api-key').apiKey).toBeNull();
  });
});
