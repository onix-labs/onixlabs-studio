import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../logger';

/**
 * Matches a host name a user may add: letters, digits, dots and dashes, with an optional port — a
 * GitHub Enterprise server such as `github.example.com` or `git.example.com:8443`.
 */
const HOST_NAME: RegExp =
  /^(?=.{1,253}(:\d{1,5})?$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;

/**
 * Keeps the hosts the user added to a hosting plugin from Settings › Version Control (Add Host): the
 * enterprise servers a plugin that accepts them is to serve beside the hosts its manifest names.
 * Persisted in their own file, keyed by plugin id.
 */
export class CustomHosts {
  /**
   * Holds the file the hosts are persisted in.
   */
  private readonly file: string;

  /**
   * Holds the added hosts, by plugin id.
   */
  private readonly hosts: Map<string, string[]>;

  /**
   * Initializes a new instance of the {@link CustomHosts} class, loading what was saved.
   * @param file The file to persist in.
   */
  public constructor(file: string) {
    this.file = file;
    this.hosts = load(file);
  }

  /**
   * Gets the hosts added to a plugin.
   * @param pluginId The plugin.
   * @returns Returns the hosts, lowercased, in the order they were added.
   */
  public hostsFor(pluginId: string): readonly string[] {
    return this.hosts.get(pluginId) ?? [];
  }

  /**
   * Adds a host to a plugin.
   * @param pluginId The plugin.
   * @param host The host name, untrusted.
   * @returns Returns the normalized host, or null when it is not a host name.
   */
  public add(pluginId: string, host: string): string | null {
    const name: string | null = normalizeHost(host);
    if (name === null) {
      return null;
    }
    const current: string[] = this.hosts.get(pluginId) ?? [];
    if (!current.includes(name)) {
      this.hosts.set(pluginId, [...current, name]);
      this.save();
    }
    return name;
  }

  /**
   * Removes a host from a plugin.
   * @param pluginId The plugin.
   * @param host The host name.
   * @returns Returns true when it was one the user added.
   */
  public remove(pluginId: string, host: string): boolean {
    const name: string = host.trim().toLowerCase();
    const current: string[] = this.hosts.get(pluginId) ?? [];
    if (!current.includes(name)) {
      return false;
    }
    const remaining: string[] = current.filter((candidate: string): boolean => candidate !== name);
    if (remaining.length === 0) {
      this.hosts.delete(pluginId);
    } else {
      this.hosts.set(pluginId, remaining);
    }
    this.save();
    return true;
  }

  /**
   * Writes the hosts to their file.
   */
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.hosts), null, 2), 'utf8');
    } catch (error: unknown) {
      logger.warn('CustomHosts', 'Could not save the added hosts', error);
    }
  }
}

/**
 * Normalizes a host the user typed: trimmed, lowercased, with any `https://` and trailing path
 * dropped, so a pasted server URL works too.
 * @param value The text typed.
 * @returns Returns the host name, or null when it is not one.
 */
export function normalizeHost(value: string): string | null {
  const name: string = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return HOST_NAME.test(name) ? name : null;
}

/**
 * Reads the saved hosts, keeping only well-formed entries.
 * @param file The file.
 * @returns Returns the hosts by plugin id.
 */
function load(file: string): Map<string, string[]> {
  const hosts: Map<string, string[]> = new Map<string, string[]>();
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed !== null && typeof parsed === 'object') {
      for (const [id, list] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          const names: string[] = list
            .filter((entry: unknown): entry is string => typeof entry === 'string')
            .map((entry: string): string | null => normalizeHost(entry))
            .filter((entry: string | null): entry is string => entry !== null);
          if (names.length > 0) {
            hosts.set(id, names);
          }
        }
      }
    }
  } catch {
    // No file yet, or an unreadable one: no added hosts.
  }
  return hosts;
}
