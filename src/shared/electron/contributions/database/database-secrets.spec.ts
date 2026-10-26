// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PassphraseUnlock } from '@shared/api/database-channels';
import type { PassphraseLock, SealedSecrets } from '@shared/api/database-document';
import { DatabaseSecrets, MachineKeychain } from './database-secrets';

/**
 * A stand-in keychain: "encrypts" by tagging and reversing, and refuses what another machine tagged.
 */
class FakeKeychain implements MachineKeychain {
  /**
   * Creates the keychain.
   * @param machine The machine it belongs to.
   * @param available Whether encryption is available.
   * @param backend The Linux storage backend it reports, if any.
   */
  public constructor(
    private readonly machine: string,
    private readonly available: boolean = true,
    private readonly backend?: string,
  ) {}

  public isEncryptionAvailable(): boolean {
    return this.available;
  }

  public getSelectedStorageBackend(): string {
    return this.backend ?? 'keychain';
  }

  public encryptString(plaintext: string): Buffer {
    return Buffer.from(`${this.machine}:${[...plaintext].reverse().join('')}`, 'utf8');
  }

  public decryptString(encrypted: Buffer): string {
    const text: string = encrypted.toString('utf8');
    if (!text.startsWith(`${this.machine}:`)) {
      throw new Error(
        'Error while decrypting the ciphertext provided to safeStorage.decryptString.',
      );
    }
    return [...text.slice(this.machine.length + 1)].reverse().join('');
  }
}

/**
 * Unlocks a passphrase the test expects to be right.
 * @param secrets The sealer.
 * @param passphrase The passphrase.
 * @param lock The lock, or null for a new one.
 * @returns Returns the handle and lock.
 */
async function unlocked(
  secrets: DatabaseSecrets,
  passphrase: string,
  lock: PassphraseLock | null,
): Promise<{ handle: string; lock: PassphraseLock }> {
  const outcome: PassphraseUnlock = await secrets.unlock(passphrase, lock);
  if (outcome.kind !== 'unlocked') {
    throw new Error('Expected the passphrase to unlock.');
  }
  return outcome;
}

describe('DatabaseSecrets', () => {
  const password: Readonly<Record<string, string>> = { password: 'correct horse battery staple' };

  it('machineSeal_opensOnTheMachineThatSealedIt_andNowhereElse', () => {
    const here: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('here'));
    const there: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('there'));

    const sealed: SealedSecrets | null = here.seal(password, null);

    expect(sealed?.scheme).toBe('machine');
    expect(sealed?.data).not.toContain('correct horse');
    expect(here.open(sealed!, null)).toEqual(password);
    expect(there.open(sealed!, null)).toBeNull();
  });

  it('machineSeal_isRefused_withoutARealKeychain', () => {
    expect(new DatabaseSecrets(new FakeKeychain('here', false)).seal(password, null)).toBeNull();
    // Linux without a keyring falls back to a fixed key, which protects nothing.
    const basic: DatabaseSecrets = new DatabaseSecrets(
      new FakeKeychain('here', true, 'basic_text'),
    );
    expect(basic.canSealWithMachine()).toBe(false);
    expect(basic.seal(password, null)).toBeNull();
  });

  it('passphraseSeal_opensAnywhere_forTheRightPassphrase', async () => {
    const here: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('here'));
    const there: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('there'));
    const made: { handle: string; lock: PassphraseLock } = await unlocked(
      here,
      'open sesame',
      null,
    );

    const sealed: SealedSecrets | null = here.seal(password, made.handle);
    const elsewhere: { handle: string } = await unlocked(there, 'open sesame', made.lock);

    expect(sealed?.scheme).toBe('passphrase');
    expect(Buffer.from(sealed!.data, 'base64').toString('utf8')).not.toContain('correct horse');
    expect(there.open(sealed!, elsewhere.handle)).toEqual(password);
  });

  it('unlock_refusesAWrongPassphrase_beforeAnySecretIsTried', async () => {
    const secrets: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('here'));
    const made: { lock: PassphraseLock } = await unlocked(secrets, 'open sesame', null);

    expect(await secrets.unlock('open barley', made.lock)).toEqual({ kind: 'wrong' });
  });

  it('passphraseSeal_doesNotOpen_withoutItsHandle_orAfterTheHandleIsForgotten', async () => {
    const secrets: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('here'));
    const made: { handle: string } = await unlocked(secrets, 'open sesame', null);
    const sealed: SealedSecrets = secrets.seal(password, made.handle)!;

    expect(secrets.open(sealed, null)).toBeNull();
    secrets.forget(made.handle);
    expect(secrets.open(sealed, made.handle)).toBeNull();
    expect(secrets.seal(password, made.handle)).toBeNull();
  });

  it('passphraseSeal_thatWasAltered_doesNotOpen', async () => {
    const secrets: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('here'));
    const made: { handle: string } = await unlocked(secrets, 'open sesame', null);
    const sealed: SealedSecrets = secrets.seal(password, made.handle)!;
    const bytes: Buffer = Buffer.from(sealed.data, 'base64');
    bytes[bytes.length - 1] ^= 0x01;

    expect(secrets.open({ ...sealed, data: bytes.toString('base64') }, made.handle)).toBeNull();
    expect(secrets.open({ ...sealed, data: 'c2hvcnQ=' }, made.handle)).toBeNull();
  });

  it('eachSeal_isFresh_soTwoSealsOfOneSecretDiffer', async () => {
    const secrets: DatabaseSecrets = new DatabaseSecrets(new FakeKeychain('here'));
    const made: { handle: string } = await unlocked(secrets, 'open sesame', null);

    expect(secrets.seal(password, made.handle)!.data).not.toBe(
      secrets.seal(password, made.handle)!.data,
    );
  });

  it('open_keepsOnlyStringSecrets', () => {
    const keychain: FakeKeychain = new FakeKeychain('here');
    const secrets: DatabaseSecrets = new DatabaseSecrets(keychain);
    const odd: SealedSecrets = {
      scheme: 'machine',
      data: keychain.encryptString('{"password":"p","count":3}').toString('base64'),
    };
    const notRecord: SealedSecrets = {
      scheme: 'machine',
      data: keychain.encryptString('["p"]').toString('base64'),
    };

    expect(secrets.open(odd, null)).toEqual({ password: 'p' });
    expect(secrets.open(notRecord, null)).toBeNull();
  });
});
