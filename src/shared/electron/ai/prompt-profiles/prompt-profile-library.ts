import { promises as fs, Dirent } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  PROMPT_PROFILE_ID_PATTERN,
  type PromptProfile,
  type PromptProfileListing,
} from '@shared/api/prompt-profile-channels';
import { parseProfileFile, serializeProfileFile } from '@shared/api/prompt-profile-file';
import { logger } from '@shared/electron/logger';

/**
 * The extension every profile file carries.
 */
const PROFILE_EXTENSION: string = '.md';

/**
 * The user's prompt profiles on disk (#1263): a directory of `<id>.md` files beside the skill
 * library. Every operation re-reads the disk rather than caching, on the skill library's grounds — the
 * folder is the user's, and they may edit it with other tools.
 */
export class PromptProfileLibrary {
  /**
   * Initializes a new instance of the {@link PromptProfileLibrary} class.
   * @param root The absolute path of the library directory. Created on first list or write.
   */
  public constructor(private readonly root: string) {}

  /**
   * Gets the library directory.
   */
  public get directory(): string {
    return this.root;
  }

  /**
   * Lists every profile, creating the folder when it is missing so the next launch knows the move
   * from the settings store has happened.
   * @returns Returns the profiles, sorted by id, and whether the folder was already there.
   */
  public async list(): Promise<PromptProfileListing> {
    let entries: Dirent[];
    let existed: boolean = true;
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      existed = false;
      entries = [];
      try {
        await fs.mkdir(this.root, { recursive: true });
      } catch (error: unknown) {
        logger.warn('PromptProfileLibrary.list', 'Could not create the profile folder', error);
      }
    }
    const profiles: PromptProfile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(PROFILE_EXTENSION)) {
        continue;
      }
      const profile: PromptProfile | null = await this.read(
        entry.name.slice(0, -PROFILE_EXTENSION.length),
      );
      if (profile !== null) {
        profiles.push(profile);
      }
    }
    profiles.sort((a: PromptProfile, b: PromptProfile): number => a.id.localeCompare(b.id));
    return { profiles, existed };
  }

  /**
   * Reads one profile.
   * @param id The profile's id.
   * @returns Returns the profile, or null when there is no such file.
   */
  public async read(id: string): Promise<PromptProfile | null> {
    const path: string | null = this.fileOf(id);
    if (path === null) {
      return null;
    }
    try {
      return parseProfileFile(id, await fs.readFile(path, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Creates or replaces a profile's file.
   * @param profile The profile.
   * @returns Returns null on success, or why it was refused.
   */
  public async save(profile: PromptProfile): Promise<string | null> {
    const path: string | null = this.fileOf(profile.id);
    if (path === null) {
      return 'The profile id may only use lower-case letters, digits and hyphens.';
    }
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(path, serializeProfileFile(profile), 'utf8');
    } catch (error: unknown) {
      logger.warn('PromptProfileLibrary.save', `Could not write profile "${profile.id}"`, error);
      return 'The profile could not be written to disk.';
    }
    return null;
  }

  /**
   * Deletes a profile's file; one that was never there is not an error.
   * @param id The profile's id.
   * @returns Resolves when the file is gone.
   */
  public async delete(id: string): Promise<void> {
    const path: string | null = this.fileOf(id);
    if (path !== null) {
      await fs.rm(path, { force: true });
      logger.info('PromptProfileLibrary.delete', `Profile "${id}" deleted`);
    }
  }

  /**
   * Resolves a profile's file, refusing any id that would leave the library.
   * @param id The profile's id.
   * @returns Returns the absolute path, or null for an id that is not a plain file name.
   */
  public fileOf(id: string): string | null {
    if (!PROMPT_PROFILE_ID_PATTERN.test(id)) {
      return null;
    }
    const path: string = resolve(this.root, `${id}${PROFILE_EXTENSION}`);
    return path.startsWith(`${resolve(this.root)}${sep}`) ? path : null;
  }
}

/**
 * The most characters a profile's instructions may carry through IPC: generous, but bounded because
 * the renderer is untrusted and an unbounded string is a way to fill the disk.
 */
export const PROFILE_INSTRUCTIONS_LIMIT: number = 64 * 1024;

/**
 * Reads a profile out of untrusted input.
 * @param value The value the renderer sent.
 * @param readScope Reads the scope out of untrusted data.
 * @returns Returns the profile, or null when it is not one.
 */
export function readProfile(
  value: unknown,
  readScope: (value: unknown) => PromptProfile['scope'],
): PromptProfile | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (
    typeof record['id'] !== 'string' ||
    typeof record['name'] !== 'string' ||
    typeof record['instructions'] !== 'string' ||
    record['instructions'].length > PROFILE_INSTRUCTIONS_LIMIT
  ) {
    return null;
  }
  return {
    id: record['id'],
    name: record['name'],
    scope: readScope(record['scope']),
    instructions: record['instructions'],
    enabled: record['enabled'] !== false,
  };
}

/**
 * Lists the profile files in a folder, for the export bundle reader.
 * @param folder The folder.
 * @returns Returns the absolute paths of the `.md` files directly inside it.
 */
export async function profileFilesIn(folder: string): Promise<readonly string[]> {
  try {
    const entries: Dirent[] = await fs.readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry: Dirent): boolean => entry.isFile() && entry.name.endsWith(PROFILE_EXTENSION))
      .map((entry: Dirent): string => join(folder, entry.name))
      .sort();
  } catch {
    return [];
  }
}
