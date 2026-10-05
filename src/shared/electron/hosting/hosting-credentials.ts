import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { HostingCredentialStore, HostingCredentialStorePorts } from './hosting-credential-store';

/**
 * Builds the production credential store: an encrypted blob in the app's user-data directory, beside
 * the AI credentials. The file keeps the name the forge contribution gave it, so a token pasted before
 * hosting became a plugin is still there afterwards.
 * @returns Returns the store.
 */
export function createHostingCredentialStore(): HostingCredentialStore {
  const file: string = join(app.getPath('userData'), 'forge-credentials.bin');
  const ports: HostingCredentialStorePorts = {
    load: (): string | null => {
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) {
        return null;
      }
      try {
        return safeStorage.decryptString(readFileSync(file));
      } catch {
        // A blob written under a different OS key (a restored machine, a changed keychain) cannot be
        // read back. Treated as no credential rather than a hard failure: the user pastes a new token.
        return null;
      }
    },
    save: (plaintext: string | null): void => {
      if (plaintext === null) {
        rmSync(file, { force: true });
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        // Refusing is deliberate: writing the token in plain text would be a worse outcome than the
        // user being unable to store one, and the status already explains a missing credential.
        return;
      }
      writeFileSync(file, safeStorage.encryptString(plaintext), { mode: 0o600 });
    },
  };
  return new HostingCredentialStore(ports);
}
