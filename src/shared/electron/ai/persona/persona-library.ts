import { randomUUID } from 'node:crypto';
import { promises as fs, Dirent } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { readPromptScope } from '@shared/api/ai-types';
import {
  clampConfidence,
  normalizeTags,
  PERSONA_ENTRY_ID_PATTERN,
  PERSONA_LIST_LIMIT,
  PERSONA_TEXT_LIMIT,
  type PersonaEntry,
  type PersonaListing,
} from '@shared/api/persona-channels';
import { parseEntryFile, serializeEntryFile } from '@shared/api/persona-entry-file';
import type { PersonaSnapshot } from '@shared/api/persona-learning-protocol';
import { logger } from '@shared/electron/logger';

/**
 * The extension every entry file carries.
 */
const ENTRY_EXTENSION: string = '.md';

/**
 * The folder, inside the persona folder, that holds one file per entry.
 */
const ENTRIES_FOLDER: string = 'entries';

/**
 * The folder, inside the persona folder, that holds copies of the persona kept by a rebuild (#1518).
 */
const SNAPSHOTS_FOLDER: string = 'snapshots';

/**
 * Matches a snapshot's folder name: the moment it was taken, made safe for a file name.
 */
const SNAPSHOT_ID_PATTERN: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z(?:-\d+)?$/;

/**
 * The file, inside the persona folder, that records facts about the persona as a whole.
 */
const STATE_FILE: string = 'persona.json';

/**
 * What the persona folder records about itself.
 */
interface PersonaFolderState {
  /**
   * Gets how many prompt profiles were converted when the persona was created.
   */
  readonly convertedProfiles: number;
}

/**
 * The user's persona on disk (#1514): a folder under the user-data path holding one `<id>.md` file per
 * entry. Every operation re-reads the disk rather than caching, on the skill library's grounds — the
 * folder is the user's, and they may edit it with other tools.
 *
 * 🔑 The first list after personas shipped converts the user's prompt profiles: each profile file is
 * read as an entry (a profile file already is one: in the core, written by the user, locked) and
 * written into the persona. The profile files are left exactly where they were, which is the backup:
 * nothing the user wrote is moved or removed, and a build from before personas still finds them.
 */
export class PersonaLibrary {
  /**
   * Holds the conversion in flight, so two windows listing at once convert once.
   */
  private creating: Promise<void> | null = null;

  /**
   * Initializes a new instance of the {@link PersonaLibrary} class.
   * @param root The absolute path of the persona folder. Created on first list or write.
   * @param profilesRoot The prompt-profile folder converted on first list, or null for none.
   */
  public constructor(
    private readonly root: string,
    private readonly profilesRoot: string | null = null,
  ) {}

  /**
   * Gets the persona folder.
   */
  public get directory(): string {
    return this.root;
  }

  /**
   * Gets the folder the entry files are in.
   */
  public get entriesDirectory(): string {
    return join(this.root, ENTRIES_FOLDER);
  }

  /**
   * Lists every entry, creating the persona (and converting the prompt profiles) when it is missing.
   * @returns Returns the entries, sorted by id, and what the folder records about itself.
   */
  public async list(): Promise<PersonaListing> {
    const existed: boolean = await this.exists();
    if (!existed) {
      this.creating ??= this.create().finally((): void => {
        this.creating = null;
      });
      await this.creating;
    }
    const entries: PersonaEntry[] = [];
    for (const id of await this.ids()) {
      const entry: PersonaEntry | null = await this.read(id);
      if (entry !== null) {
        entries.push(entry);
      }
    }
    entries.sort((a: PersonaEntry, b: PersonaEntry): number => a.id.localeCompare(b.id));
    const state: PersonaFolderState = await this.readState();
    return { entries, convertedProfiles: state.convertedProfiles, existed };
  }

  /**
   * Lists the ids of the entries on disk.
   * @returns Returns the ids, unsorted.
   */
  public async ids(): Promise<readonly string[]> {
    let files: Dirent[];
    try {
      files = await fs.readdir(this.entriesDirectory, { withFileTypes: true });
    } catch {
      return [];
    }
    return files
      .filter((file: Dirent): boolean => file.isFile() && file.name.endsWith(ENTRY_EXTENSION))
      .map((file: Dirent): string => file.name.slice(0, -ENTRY_EXTENSION.length))
      .filter((id: string): boolean => PERSONA_ENTRY_ID_PATTERN.test(id));
  }

  /**
   * Reads one entry.
   * @param id The entry's id.
   * @returns Returns the entry, or null when there is no such file.
   */
  public async read(id: string): Promise<PersonaEntry | null> {
    const path: string | null = this.fileOf(id);
    if (path === null) {
      return null;
    }
    try {
      return parseEntryFile(id, await fs.readFile(path, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Creates or replaces an entry's file. Written beside the target and renamed over it, so a reader
   * (learning, another window, the user's editor) never sees half a file.
   * @param entry The entry.
   * @returns Returns null on success, or why it was refused.
   */
  public async save(entry: PersonaEntry): Promise<string | null> {
    const path: string | null = this.fileOf(entry.id);
    if (path === null) {
      return 'The entry id may only use lower-case letters, digits and hyphens.';
    }
    const staged: string = `${path}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(this.entriesDirectory, { recursive: true });
      await fs.writeFile(staged, serializeEntryFile(entry), 'utf8');
      await fs.rename(staged, path);
    } catch (error: unknown) {
      logger.warn('PersonaLibrary.save', `Could not write entry "${entry.id}"`, error);
      await fs.rm(staged, { force: true }).catch((): void => undefined);
      return 'The entry could not be written to disk.';
    }
    return null;
  }

  /**
   * Deletes an entry's file; one that was never there is not an error.
   * @param id The entry's id.
   * @returns Resolves when the file is gone.
   */
  public async delete(id: string): Promise<void> {
    const path: string | null = this.fileOf(id);
    if (path !== null) {
      await fs.rm(path, { force: true });
      logger.info('PersonaLibrary.delete', `Entry "${id}" deleted`);
    }
  }

  /**
   * Resolves an entry's file, refusing any id that would leave the persona.
   * @param id The entry's id.
   * @returns Returns the absolute path, or null for an id that is not a plain file name.
   */
  public fileOf(id: string): string | null {
    if (!PERSONA_ENTRY_ID_PATTERN.test(id)) {
      return null;
    }
    const folder: string = resolve(this.entriesDirectory);
    const path: string = resolve(folder, `${id}${ENTRY_EXTENSION}`);
    return path.startsWith(`${folder}${sep}`) ? path : null;
  }

  /**
   * Keeps a copy of every entry as it stands (#1518): a folder under `snapshots`, named for the
   * moment, that {@link restore} can put back.
   * @param now The moment.
   * @returns Returns the copy.
   */
  public async snapshot(now: Date = new Date()): Promise<PersonaSnapshot> {
    const stamp: string = now.toISOString().replace(/:/g, '-').replace('.', '-');
    let id: string = stamp;
    for (
      let suffix: number = 2;
      await pathExists(join(this.root, SNAPSHOTS_FOLDER, id));
      suffix += 1
    ) {
      id = `${stamp}-${suffix}`;
    }
    const folder: string = join(this.root, SNAPSHOTS_FOLDER, id);
    await fs.mkdir(folder, { recursive: true });
    const ids: readonly string[] = await this.ids();
    for (const entryId of ids) {
      await fs.copyFile(
        join(this.entriesDirectory, `${entryId}${ENTRY_EXTENSION}`),
        join(folder, `${entryId}${ENTRY_EXTENSION}`),
      );
    }
    logger.info('PersonaLibrary.snapshot', `Kept a copy of ${ids.length} entr(ies) as ${id}`);
    return { id, takenAt: now.getTime(), entries: ids.length };
  }

  /**
   * Lists the kept copies, newest first.
   * @returns Returns them.
   */
  public async snapshots(): Promise<readonly PersonaSnapshot[]> {
    let folders: Dirent[];
    try {
      folders = await fs.readdir(join(this.root, SNAPSHOTS_FOLDER), { withFileTypes: true });
    } catch {
      return [];
    }
    const found: PersonaSnapshot[] = [];
    for (const folder of folders) {
      if (!folder.isDirectory() || !SNAPSHOT_ID_PATTERN.test(folder.name)) {
        continue;
      }
      const files: readonly string[] = await profileFilesIn(
        join(this.root, SNAPSHOTS_FOLDER, folder.name),
      );
      const taken: number = Date.parse(
        folder.name.replace(
          /T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z.*$/,
          (_match: string, h: string, m: string, sec: string, ms: string | undefined): string =>
            `T${h}:${m}:${sec}.${ms ?? '000'}Z`,
        ),
      );
      found.push({
        id: folder.name,
        takenAt: Number.isNaN(taken) ? 0 : taken,
        entries: files.length,
      });
    }
    return found.sort((a: PersonaSnapshot, b: PersonaSnapshot): number => b.takenAt - a.takenAt);
  }

  /**
   * Puts a kept copy back: the entries become exactly the copy's. What stood before is kept as a copy
   * of its own first, so a restore can itself be undone.
   * @param id The copy.
   * @returns Returns true when it was put back.
   */
  public async restore(id: string): Promise<boolean> {
    if (!SNAPSHOT_ID_PATTERN.test(id)) {
      return false;
    }
    const folder: string = join(this.root, SNAPSHOTS_FOLDER, id);
    if (!(await pathExists(folder))) {
      return false;
    }
    await this.snapshot();
    const files: readonly string[] = await profileFilesIn(folder);
    for (const entryId of await this.ids()) {
      await this.delete(entryId);
    }
    await fs.mkdir(this.entriesDirectory, { recursive: true });
    for (const file of files) {
      await fs.copyFile(file, join(this.entriesDirectory, basename(file)));
    }
    logger.info('PersonaLibrary.restore', `Put back the copy ${id} (${files.length} entr(ies))`);
    return true;
  }

  /**
   * Determines whether the persona has been created.
   * @returns Returns true when the entries folder is there.
   */
  private async exists(): Promise<boolean> {
    try {
      await fs.access(this.entriesDirectory);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates the persona, converting every prompt profile into it, and records how many were.
   * @returns Resolves once the folder is there.
   */
  private async create(): Promise<void> {
    try {
      await fs.mkdir(this.entriesDirectory, { recursive: true });
    } catch (error: unknown) {
      logger.warn('PersonaLibrary.create', 'Could not create the persona folder', error);
      return;
    }
    const files: readonly string[] =
      this.profilesRoot === null ? [] : await profileFilesIn(this.profilesRoot);
    let converted: number = 0;
    for (const file of files) {
      const id: string = basename(file).slice(0, -ENTRY_EXTENSION.length);
      if (!PERSONA_ENTRY_ID_PATTERN.test(id)) {
        continue;
      }
      try {
        const entry: PersonaEntry = parseEntryFile(id, await fs.readFile(file, 'utf8'));
        if ((await this.save(entry)) === null) {
          converted += 1;
        }
      } catch (error: unknown) {
        logger.warn('PersonaLibrary.create', `Could not convert profile ${file}`, error);
      }
    }
    await this.writeState({ convertedProfiles: converted });
    logger.info(
      'PersonaLibrary.create',
      `Persona created at ${this.root}; ${converted} prompt profile(s) converted`,
    );
  }

  /**
   * Reads what the folder records about itself.
   * @returns Returns the state, or the defaults when the file is missing or unreadable.
   */
  private async readState(): Promise<PersonaFolderState> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(join(this.root, STATE_FILE), 'utf8'));
      const record: Record<string, unknown> =
        parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      const converted: unknown = record['convertedProfiles'];
      return {
        convertedProfiles:
          typeof converted === 'number' && Number.isInteger(converted) && converted > 0
            ? converted
            : 0,
      };
    } catch {
      return { convertedProfiles: 0 };
    }
  }

  /**
   * Records facts about the folder.
   * @param state The state.
   * @returns Resolves once written; a failure is logged, since nothing depends on it but a notice.
   */
  private async writeState(state: PersonaFolderState): Promise<void> {
    try {
      await fs.writeFile(
        join(this.root, STATE_FILE),
        `${JSON.stringify(state, null, 2)}\n`,
        'utf8',
      );
    } catch (error: unknown) {
      logger.warn('PersonaLibrary.writeState', 'Could not record the persona state', error);
    }
  }
}

/**
 * Reads an entry out of untrusted input.
 * @param value The value the renderer sent.
 * @returns Returns the entry, or null when it is not one.
 */
export function readEntry(value: unknown): PersonaEntry | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const strings: (key: string) => readonly string[] = (key: string): readonly string[] => {
    const list: unknown = record[key];
    return Array.isArray(list)
      ? list
          .filter((item: unknown): item is string => typeof item === 'string')
          .slice(0, PERSONA_LIST_LIMIT)
      : [];
  };
  if (
    typeof record['id'] !== 'string' ||
    typeof record['name'] !== 'string' ||
    typeof record['text'] !== 'string' ||
    record['text'].length > PERSONA_TEXT_LIMIT ||
    record['name'].length > 512
  ) {
    return null;
  }
  const why: unknown = record['why'];
  const confirmed: unknown = record['confirmed'];
  const confidence: unknown = record['confidence'];
  return {
    id: record['id'],
    name: record['name'],
    text: record['text'],
    why: typeof why === 'string' ? why.slice(0, 4096) : '',
    tags: normalizeTags(strings('tags')),
    links: strings('links').filter(
      (link: string): boolean => PERSONA_ENTRY_ID_PATTERN.test(link) && link !== record['id'],
    ),
    scope: readPromptScope(record['scope']),
    layer: record['layer'] === 'memory' ? 'memory' : 'core',
    enabled: record['enabled'] !== false,
    confidence: typeof confidence === 'number' ? clampConfidence(confidence) : 1,
    confirmed:
      typeof confirmed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(confirmed) ? confirmed : '',
    author: record['author'] === 'learned' ? 'learned' : 'user',
    locked: record['locked'] === true,
  };
}

/**
 * Lists the prompt-profile files in a folder, to convert them.
 * @param folder The folder.
 * @returns Returns the absolute paths of the `.md` files directly inside it, sorted.
 */
async function profileFilesIn(folder: string): Promise<readonly string[]> {
  try {
    const files: Dirent[] = await fs.readdir(folder, { withFileTypes: true });
    return files
      .filter((file: Dirent): boolean => file.isFile() && file.name.endsWith(ENTRY_EXTENSION))
      .map((file: Dirent): string => join(folder, file.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Determines whether a path exists.
 * @param path The path.
 * @returns Returns true when something is there.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
