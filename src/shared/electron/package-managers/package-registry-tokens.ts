import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { HostingCredentialStorePorts } from '../hosting/hosting-credential-store';
import { PackageRegistryTokenStore } from './package-registry-token-store';

/**
 * Builds the production registry-token store: an encrypted blob in the app's user-data directory,
 * beside the hosting and AI credentials.
 * @returns Returns the store.
 */
export function createPackageRegistryTokens(): PackageRegistryTokenStore {
  const file: string = join(app.getPath('userData'), 'package-registry-tokens.bin');
  const ports: HostingCredentialStorePorts = {
    load: (): string | null => {
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) {
        return null;
      }
      try {
        return safeStorage.decryptString(readFileSync(file));
      } catch {
        // Written under a different OS key (a restored machine, a changed keychain): treated as no
        // token rather than a failure, and the user saves a new one.
        return null;
      }
    },
    save: (plaintext: string | null): void => {
      if (plaintext === null) {
        rmSync(file, { force: true });
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        // ⛔ Refused rather than written in plain text.
        return;
      }
      writeFileSync(file, safeStorage.encryptString(plaintext), { mode: 0o600 });
    },
  };
  return new PackageRegistryTokenStore(ports);
}
