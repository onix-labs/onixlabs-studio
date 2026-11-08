// Reads Maven's user settings (`~/.m2/settings.xml`): the mirrors that replace repositories, the
// repositories active profiles add, and the `<servers>` credentials bound to repository ids.
//
// ⛔ A server's credential is bound to its id AND to the URL this same file gives that id (a mirror's or
// an active profile repository's). A POM can declare a repository with any id and any URL, so an id
// alone would let a project in the folder send the user's password to a host of its choosing.
//
// ⛔ A value holding `${…}` is no credential: Studio cuts the plugin's environment down to an allow-list,
// so it would resolve to nothing, or worse, to something the user never meant to send. An encrypted
// password (`{…}`, from `settings-security.xml`) is no credential either: it is readable only by Maven.

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { normaliseRepositoryUrl } from './repositories';
import { child, children, childText, parseXml, XmlElement } from './xml';

/**
 * A mirror: a repository that stands in for others.
 */
export interface MavenMirror {
  /**
   * Gets the mirror's id, which its credential is bound to.
   */
  readonly id: string;

  /**
   * Gets the mirror's URL.
   */
  readonly url: string;

  /**
   * Gets which repositories it stands in for: `*`, `external:*`, ids, and `!id` exclusions.
   */
  readonly mirrorOf: string;
}

/**
 * A repository named in the settings, by an active profile.
 */
export interface SettingsRepository {
  /**
   * Gets the repository id.
   */
  readonly id: string;

  /**
   * Gets the repository URL.
   */
  readonly url: string;
}

/**
 * A server's credential.
 */
export interface ServerCredential {
  /**
   * Gets the user name, empty when none is given.
   */
  readonly username: string;

  /**
   * Gets the password or token.
   */
  readonly password: string;
}

/**
 * What the settings say about repositories.
 */
export interface MavenSettings {
  /**
   * Gets the mirrors, in the order declared: the first that matches a repository wins.
   */
  readonly mirrors: readonly MavenMirror[];

  /**
   * Gets the repositories the active profiles add.
   */
  readonly repositories: readonly SettingsRepository[];

  /**
   * Gets the usable credentials, by server id.
   */
  readonly servers: ReadonlyMap<string, ServerCredential>;
}

/**
 * Settings with nothing in them, for a machine with no `settings.xml`.
 */
export const EMPTY_SETTINGS: MavenSettings = {
  mirrors: [],
  repositories: [],
  servers: new Map<string, ServerCredential>(),
};

/**
 * Determines whether a configured value can be used as a credential.
 * @param value The value, or null.
 * @returns Returns true when it is a literal, not a reference or an encrypted one.
 */
function usable(value: string | null): value is string {
  return value !== null && !value.includes('${') && !(value.startsWith('{') && value.endsWith('}'));
}

/**
 * Reads the repositories of the profiles a settings file activates: those listed in
 * `<activeProfiles>`, and those marked `<activeByDefault>true</activeByDefault>`.
 * @param settings The `<settings>` element.
 * @returns Returns the repositories.
 */
function profileRepositories(settings: XmlElement): readonly SettingsRepository[] {
  const active: ReadonlySet<string> = new Set<string>(
    children(child(settings, 'activeProfiles'), 'activeProfile').map(
      (element: XmlElement): string => element.text.trim(),
    ),
  );
  const repositories: SettingsRepository[] = [];
  for (const profile of children(child(settings, 'profiles'), 'profile')) {
    const id: string | null = childText(profile, 'id');
    const byDefault: boolean =
      childText(child(profile, 'activation'), 'activeByDefault')?.toLowerCase() === 'true';
    if (!byDefault && (id === null || !active.has(id))) {
      continue;
    }
    for (const repository of children(child(profile, 'repositories'), 'repository')) {
      const repositoryId: string | null = childText(repository, 'id');
      const url: string | null = normaliseRepositoryUrl(childText(repository, 'url') ?? '');
      if (repositoryId !== null && url !== null) {
        repositories.push({ id: repositoryId, url });
      }
    }
  }
  return repositories;
}

/**
 * Reads a settings file.
 * @param xml The file's text.
 * @returns Returns what it says about repositories.
 */
export function parseMavenSettings(xml: string): MavenSettings {
  const settings: XmlElement | null = parseXml(xml);
  if (settings?.name !== 'settings') {
    return EMPTY_SETTINGS;
  }
  const mirrors: MavenMirror[] = [];
  for (const mirror of children(child(settings, 'mirrors'), 'mirror')) {
    const id: string | null = childText(mirror, 'id');
    const url: string | null = normaliseRepositoryUrl(childText(mirror, 'url') ?? '');
    const mirrorOf: string | null = childText(mirror, 'mirrorOf');
    if (id !== null && url !== null && mirrorOf !== null) {
      mirrors.push({ id, url, mirrorOf });
    }
  }
  const servers: Map<string, ServerCredential> = new Map<string, ServerCredential>();
  for (const server of children(child(settings, 'servers'), 'server')) {
    const id: string | null = childText(server, 'id');
    const username: string | null = childText(server, 'username');
    const password: string | null = childText(server, 'password');
    if (id !== null && usable(password) && (username === null || usable(username))) {
      servers.set(id, { username: username ?? '', password });
    }
  }
  return { mirrors, repositories: profileRepositories(settings), servers };
}

/**
 * Determines whether a mirror stands in for a repository, as Maven decides it: `*` is every
 * repository, `external:*` every one not on this machine, a name that one, and `!name` excludes it.
 * @param mirrorOf The mirror's `<mirrorOf>`.
 * @param id The repository's id.
 * @param url The repository's URL.
 * @returns Returns true when the mirror replaces the repository.
 */
export function mirrors(mirrorOf: string, id: string, url: string): boolean {
  const patterns: readonly string[] = mirrorOf
    .split(',')
    .map((pattern: string): string => pattern.trim())
    .filter((pattern: string): boolean => pattern.length > 0);
  if (patterns.includes(`!${id}`)) {
    return false;
  }
  return patterns.some((pattern: string): boolean => {
    if (pattern === '*' || pattern === id) {
      return true;
    }
    return pattern === 'external:*' && !isLocal(url);
  });
}

/**
 * Determines whether a repository URL is on this machine, which `external:*` leaves alone.
 * @param url The URL.
 * @returns Returns true for loopback and `file:` URLs.
 */
function isLocal(url: string): boolean {
  try {
    const parsed: URL = new URL(url);
    return (
      parsed.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Finds the user's settings file: `$HOME/.m2/settings.xml`. Maven's global settings (in its own install)
 * are not read: where Maven is installed is not something the plugin can know without running it.
 * @returns Returns the path.
 */
export function userSettingsPath(): string {
  return path.join(os.homedir(), '.m2', 'settings.xml');
}

/**
 * Reads the user's settings, or none when there is no file.
 * @returns Returns the settings.
 */
export async function readMavenSettings(): Promise<MavenSettings> {
  try {
    return parseMavenSettings(await fs.readFile(userSettingsPath(), 'utf8'));
  } catch {
    return EMPTY_SETTINGS;
  }
}
