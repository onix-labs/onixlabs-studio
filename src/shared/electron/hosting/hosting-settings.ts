import * as fs from 'node:fs';
import * as path from 'node:path';
import { HostingAuthMode, isHostingAuthMode } from '@shared/api/hosting-protocol';
import { logger } from '../logger';

/**
 * Holds how each hosting plugin signs in to each of its hosts, as the user chose in Settings (#819).
 *
 * Per host rather than per plugin: one GitHub plugin can serve github.com and a company's GitHub
 * Enterprise server, and the user may want `gh`'s login for one and a token kept in Studio for the
 * other. A host with no choice uses the plugin's default — its CLI's login when that is signed in,
 * Studio's otherwise.
 *
 * Kept in the main process, in a small file under the user-data directory, because the host needs it
 * when it starts a plugin and when the plugin asks for a credential.
 */
export class HostingSettings {
  /**
   * Holds the file the choices are persisted to.
   */
  private readonly file: string;

  /**
   * Holds the choices, keyed by plugin id, then by host.
   */
  private readonly choices: Map<string, Map<string, HostingAuthMode>>;

  /**
   * Initializes the store, reading what was saved.
   * @param file The file the choices are persisted to.
   */
  public constructor(file: string) {
    this.file = file;
    this.choices = load(file);
  }

  /**
   * Gets how a plugin signs in to each of its hosts that has a choice.
   * @param pluginId The plugin.
   * @returns Returns the choices by host; a host absent from it uses the plugin's default.
   */
  public authFor(pluginId: string): Readonly<Record<string, HostingAuthMode>> {
    return Object.fromEntries(this.choices.get(pluginId) ?? new Map<string, HostingAuthMode>());
  }

  /**
   * Sets how a plugin signs in to one host, persisting it.
   * @param pluginId The plugin.
   * @param host The host, which is lowercased.
   * @param mode The choice, or null to return to the plugin's default.
   */
  public setAuth(pluginId: string, host: string, mode: HostingAuthMode | null): void {
    const byHost: Map<string, HostingAuthMode> =
      this.choices.get(pluginId) ?? new Map<string, HostingAuthMode>();
    if (mode === null) {
      byHost.delete(host.toLowerCase());
    } else {
      byHost.set(host.toLowerCase(), mode);
    }
    if (byHost.size === 0) {
      this.choices.delete(pluginId);
    } else {
      this.choices.set(pluginId, byHost);
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const serialised: Record<string, Record<string, HostingAuthMode>> = Object.fromEntries(
        [...this.choices].map(
          ([id, hosts]: [string, Map<string, HostingAuthMode>]): [
            string,
            Record<string, HostingAuthMode>,
          ] => [id, Object.fromEntries(hosts)],
        ),
      );
      fs.writeFileSync(this.file, JSON.stringify(serialised, null, 2), 'utf8');
    } catch (error: unknown) {
      logger.warn('HostingSettings', 'Could not save the hosting settings', error);
    }
  }
}

/**
 * Reads the saved choices, ignoring a missing or malformed file and any malformed entry.
 * @param file The file.
 * @returns Returns the choices by plugin id, then by host.
 */
function load(file: string): Map<string, Map<string, HostingAuthMode>> {
  const choices: Map<string, Map<string, HostingAuthMode>> = new Map<
    string,
    Map<string, HostingAuthMode>
  >();
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) {
      return choices;
    }
    for (const [id, hosts] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof hosts !== 'object' || hosts === null) {
        continue;
      }
      const byHost: Map<string, HostingAuthMode> = new Map<string, HostingAuthMode>();
      for (const [host, mode] of Object.entries(hosts as Record<string, unknown>)) {
        if (isHostingAuthMode(mode)) {
          byHost.set(host.toLowerCase(), mode);
        }
      }
      if (byHost.size > 0) {
        choices.set(id, byHost);
      }
    }
  } catch {
    // No file yet, or one that cannot be read: every plugin uses its default.
  }
  return choices;
}
