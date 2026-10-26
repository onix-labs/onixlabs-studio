import {
  CipherGCM,
  createCipheriv,
  createDecipheriv,
  DecipherGCM,
  randomBytes,
  randomUUID,
  scrypt,
} from 'node:crypto';
import type { PassphraseUnlock } from '@shared/api/database-channels';
import type { PassphraseLock, SealedSecrets } from '@shared/api/database-document';

/**
 * The part of Electron's `safeStorage` the sealer uses, so a spec can stand in for the keychain.
 */
export interface MachineKeychain {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * The value a passphrase lock seals, so a passphrase is proved right or wrong before any secret is
 * opened with it.
 */
const CHECK_VALUE: string = 'onixlabs.studio.database';

/**
 * The scrypt cost: 2^15 iterations at r = 8 takes about 32MiB and a few tens of milliseconds, which is
 * paid once per unlock rather than once per secret.
 */
const SCRYPT_COST: number = 2 ** 15;

/**
 * The memory scrypt may use, above what {@link SCRYPT_COST} needs (Node's default is exactly 32MiB,
 * which that cost does not fit).
 */
const SCRYPT_MEMORY: number = 64 * 1024 * 1024;

/**
 * Seals and opens a Database Explorer document's remembered secrets (#1097), in main so that neither
 * a key nor a sealed secret's plaintext lives anywhere the renderer persists.
 *
 * A secret is sealed one of two ways. With the machine's keychain (`safeStorage`), it opens without
 * asking on the machine that sealed it and on no other. With a document passphrase — scrypt for the
 * key, AES-256-GCM for the seal — it opens anywhere for whoever knows the passphrase. The derived key
 * is kept here behind a random handle, which is all the renderer ever holds.
 */
export class DatabaseSecrets {
  /**
   * Holds the keys derived from unlocked passphrases, by handle.
   */
  private readonly keys: Map<string, Buffer> = new Map<string, Buffer>();

  /**
   * Creates the sealer.
   * @param keychain The machine's keychain.
   */
  public constructor(private readonly keychain: MachineKeychain) {}

  /**
   * Determines whether this machine can seal with its keychain. Linux without a keyring falls back to a
   * fixed key (`basic_text`), which is no protection at all, so that counts as unable.
   * @returns Returns true when it can.
   */
  public canSealWithMachine(): boolean {
    if (!this.keychain.isEncryptionAvailable()) {
      return false;
    }
    return this.keychain.getSelectedStorageBackend?.() !== 'basic_text';
  }

  /**
   * Unlocks a passphrase against a document's lock, or makes a new lock when there is none.
   * @param passphrase The passphrase.
   * @param lock The document's lock, or null to make one.
   * @returns Returns a promise resolving the handle and the lock, or that the passphrase is wrong.
   */
  public async unlock(passphrase: string, lock: PassphraseLock | null): Promise<PassphraseUnlock> {
    const salt: Buffer = lock === null ? randomBytes(16) : Buffer.from(lock.salt, 'base64');
    const key: Buffer = await derive(passphrase, salt);
    if (lock !== null && open(key, lock.check) !== CHECK_VALUE) {
      return { kind: 'wrong' };
    }
    const handle: string = randomUUID();
    this.keys.set(handle, key);
    return {
      kind: 'unlocked',
      handle,
      lock: lock ?? { salt: salt.toString('base64'), check: seal(key, CHECK_VALUE) },
    };
  }

  /**
   * Seals a connection's secrets.
   * @param secrets The secrets, by field id.
   * @param handle The unlocked passphrase to seal with, or null for the machine's keychain.
   * @returns Returns the seal, or null when it cannot be made (no keychain, or an unknown handle).
   */
  public seal(
    secrets: Readonly<Record<string, string>>,
    handle: string | null,
  ): SealedSecrets | null {
    const plaintext: string = JSON.stringify(secrets);
    if (handle !== null) {
      const key: Buffer | undefined = this.keys.get(handle);
      return key === undefined ? null : { scheme: 'passphrase', data: seal(key, plaintext) };
    }
    if (!this.canSealWithMachine()) {
      return null;
    }
    return {
      scheme: 'machine',
      data: this.keychain.encryptString(plaintext).toString('base64'),
    };
  }

  /**
   * Opens a seal.
   * @param sealed The seal.
   * @param handle The unlocked passphrase, for a passphrase seal.
   * @returns Returns the secrets, or null when this machine or handle cannot open them.
   */
  public open(
    sealed: SealedSecrets,
    handle: string | null,
  ): Readonly<Record<string, string>> | null {
    let plaintext: string | null = null;
    if (sealed.scheme === 'passphrase') {
      const key: Buffer | undefined = handle === null ? undefined : this.keys.get(handle);
      plaintext = key === undefined ? null : open(key, sealed.data);
    } else if (this.keychain.isEncryptionAvailable()) {
      try {
        plaintext = this.keychain.decryptString(Buffer.from(sealed.data, 'base64'));
      } catch {
        // Sealed on another machine, or with a keychain entry since replaced.
        plaintext = null;
      }
    }
    return plaintext === null ? null : asSecrets(plaintext);
  }

  /**
   * Forgets a handle's key.
   * @param handle The handle.
   */
  public forget(handle: string): void {
    this.keys.get(handle)?.fill(0);
    this.keys.delete(handle);
  }
}

/**
 * Derives a passphrase's key.
 * @param passphrase The passphrase.
 * @param salt The salt.
 * @returns Returns a promise resolving the 32-byte key.
 */
function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve: (key: Buffer) => void, reject: (error: Error) => void) => {
    scrypt(
      passphrase.normalize('NFC'),
      salt,
      32,
      { N: SCRYPT_COST, r: 8, p: 1, maxmem: SCRYPT_MEMORY },
      (error: Error | null, key: Buffer): void => (error === null ? resolve(key) : reject(error)),
    );
  });
}

/**
 * Seals text with AES-256-GCM.
 * @param key The key.
 * @param plaintext The text.
 * @returns Returns the nonce, tag and ciphertext together, base64.
 */
function seal(key: Buffer, plaintext: string): string {
  const nonce: Buffer = randomBytes(12);
  const cipher: CipherGCM = createCipheriv('aes-256-gcm', key, nonce);
  const body: Buffer = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
}

/**
 * Opens text sealed by {@link seal}.
 * @param key The key.
 * @param sealed The sealed text, base64.
 * @returns Returns the text, or null when the key is wrong or the seal was altered.
 */
function open(key: Buffer, sealed: string): string | null {
  const bytes: Buffer = Buffer.from(sealed, 'base64');
  if (bytes.length < 28) {
    return null;
  }
  try {
    const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Reads opened secrets, keeping only string values.
 * @param plaintext The opened text.
 * @returns Returns the secrets, or null when it is not a secrets record.
 */
function asSecrets(plaintext: string): Readonly<Record<string, string>> | null {
  try {
    const value: unknown = JSON.parse(plaintext);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry: [string, unknown]): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return null;
  }
}
