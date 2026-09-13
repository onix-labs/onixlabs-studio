import { promises as fs, Dirent } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { scopeMatches, type AgentSurface } from '@shared/api/ai-types';
import {
  SKILL_FILE,
  SKILL_NAME_PATTERN,
  type Skill,
  type SkillDraft,
  type SkillSaveResult,
} from '@shared/api/skill-channels';
import { logger } from '@shared/electron/logger';
import type { OfferedSkill } from '../agent-provider';
import {
  parseSkillFile,
  serializeSkillFile,
  skillProblem,
  type ParsedSkillFile,
} from './skill-file';

/**
 * Folders never listed as bundled files: version control and editor litter that a user who keeps
 * the library in a repository will have beside their skills.
 */
const IGNORED_ENTRIES: readonly string[] = ['.git', '.DS_Store', 'node_modules', 'Thumbs.db'];

/**
 * The most bundled files listed for one skill. A skill bundling a whole tree is listed up to here and
 * told the rest exists, because the list goes to the model verbatim and a thousand paths would
 * displace the instructions they accompany.
 */
const BUNDLED_FILE_LIMIT: number = 50;

/**
 * What a run start asks of the library: the skills in scope for a surface and language. Narrowed to
 * one method so the AI manager depends on the question, not on the folder that answers it.
 */
export interface SkillOfferer {
  /**
   * Resolves the skills to offer a run.
   * @param surface The run's surface.
   * @param language The run's language, or null.
   * @returns Returns the skills in scope.
   */
  offer(surface: AgentSurface, language: string | null): Promise<readonly OfferedSkill[]>;
}

/**
 * The user's skill library on disk (#301): a directory of skill folders, each holding a `SKILL.md`.
 *
 * 🔑 The folder name IS the skill's name. The frontmatter carries a `name` too, because the format is
 * the SDK's and readers of that format expect one, but when the two disagree the folder wins — the
 * folder is what the file system enforces to be unique, and a rename is a move.
 *
 * Every operation re-reads the disk rather than caching, on the same grounds as the environment
 * probes: the library is the user's, they edit it with other tools, and a stale listing would tell
 * them their edit did nothing.
 */
export class SkillLibrary implements SkillOfferer {
  /**
   * Initializes a new instance of the {@link SkillLibrary} class.
   * @param root The absolute path of the library directory. Created on first write.
   */
  public constructor(private readonly root: string) {}

  /**
   * Gets the library directory.
   */
  public get directory(): string {
    return this.root;
  }

  /**
   * Lists every skill folder, valid or not, sorted by name.
   * @returns Returns the skills.
   */
  public async list(): Promise<readonly Skill[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const skills: Skill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_ENTRIES.includes(entry.name)) {
        continue;
      }
      const skill: Skill | null = await this.read(entry.name);
      if (skill !== null) {
        skills.push(skill);
      }
    }
    return skills.sort((a: Skill, b: Skill): number => a.name.localeCompare(b.name));
  }

  /**
   * Reads one skill folder.
   * @param name The folder name.
   * @returns Returns the skill, or null when the folder holds no `SKILL.md`.
   */
  public async read(name: string): Promise<Skill | null> {
    const directory: string | null = this.folderOf(name);
    if (directory === null) {
      return null;
    }
    let text: string;
    try {
      text = await fs.readFile(join(directory, SKILL_FILE), 'utf8');
    } catch {
      return null;
    }
    const parsed: ParsedSkillFile = parseSkillFile(text);
    const files: readonly string[] = await this.bundledFiles(directory);
    return {
      name,
      description: parsed.description,
      scope: parsed.scope,
      enabled: parsed.enabled,
      body: parsed.body,
      directory,
      files,
      problem:
        skillProblem(name, parsed.description) ??
        (parsed.name !== null && parsed.name !== name
          ? `The frontmatter names it "${parsed.name}" but the folder is "${name}"; the folder wins.`
          : null),
    };
  }

  /**
   * Creates or replaces a skill from a draft, renaming its folder when the draft says to.
   * @param draft The draft.
   * @returns Returns the outcome.
   */
  public async save(draft: SkillDraft): Promise<SkillSaveResult> {
    const name: string = draft.name.trim().toLowerCase();
    const description: string = draft.description.trim();
    const problem: string | null = skillProblem(name, description);
    if (problem !== null) {
      return { skill: null, error: problem };
    }
    const target: string = join(this.root, name);
    const previous: string | null =
      draft.previousName !== undefined && draft.previousName !== name
        ? this.folderOf(draft.previousName)
        : null;
    try {
      await fs.mkdir(this.root, { recursive: true });
      if (previous !== null) {
        if (await this.exists(target)) {
          return { skill: null, error: `A skill named "${name}" already exists.` };
        }
        await fs.rename(previous, target);
      } else {
        await fs.mkdir(target, { recursive: true });
      }
      // Keys another tool wrote are carried across a save, so editing the description here does not
      // strip, say, an `allowed-tools` line the file arrived with.
      const existing: string | null = await this.readText(join(target, SKILL_FILE));
      const foreignLines: readonly string[] =
        existing === null ? [] : parseSkillFile(existing).foreignLines;
      await fs.writeFile(
        join(target, SKILL_FILE),
        serializeSkillFile({
          name,
          description,
          scope: draft.scope,
          enabled: draft.enabled,
          body: draft.body,
          foreignLines,
        }),
        'utf8',
      );
    } catch (error: unknown) {
      logger.warn('SkillLibrary.save', `Could not write skill "${name}"`, error);
      return { skill: null, error: 'The skill could not be written to disk.' };
    }
    logger.info(
      'SkillLibrary.save',
      `Skill "${name}" saved${previous === null ? '' : ' (renamed)'}`,
    );
    return { skill: await this.read(name), error: null };
  }

  /**
   * Deletes a skill's folder and everything in it.
   * @param name The skill's name.
   * @returns Resolves when the folder is gone; a folder that was never there is not an error.
   */
  public async delete(name: string): Promise<void> {
    const directory: string | null = this.folderOf(name);
    if (directory === null) {
      return;
    }
    await fs.rm(directory, { recursive: true, force: true });
    logger.info('SkillLibrary.delete', `Skill "${name}" deleted`);
  }

  /**
   * Copies a skill from elsewhere on disk into the library.
   * @param source The path of a `SKILL.md`, or of a folder holding one.
   * @returns Returns the outcome.
   */
  public async import(source: string): Promise<SkillSaveResult> {
    const folder: string = basename(source) === SKILL_FILE ? resolve(source, '..') : source;
    const text: string | null = await this.readText(join(folder, SKILL_FILE));
    if (text === null) {
      return { skill: null, error: `No ${SKILL_FILE} was found there.` };
    }
    const parsed: ParsedSkillFile = parseSkillFile(text);
    const name: string = (parsed.name ?? basename(folder)).trim().toLowerCase();
    const problem: string | null = skillProblem(name, parsed.description);
    if (problem !== null) {
      return { skill: null, error: problem };
    }
    const target: string = join(this.root, name);
    if (await this.exists(target)) {
      return { skill: null, error: `A skill named "${name}" already exists.` };
    }
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.cp(folder, target, { recursive: true });
    } catch (error: unknown) {
      logger.warn('SkillLibrary.import', `Could not copy "${folder}"`, error);
      return { skill: null, error: 'The skill could not be copied into the library.' };
    }
    logger.info('SkillLibrary.import', `Skill "${name}" imported from ${folder}`);
    return { skill: await this.read(name), error: null };
  }

  /**
   * Resolves the skills to offer a run: enabled, valid, and in scope — as the run's model will see
   * them, with a loader that re-reads the body when asked so an edit made mid-conversation is what
   * the next load returns.
   * @param surface The run's surface.
   * @param language The run's language, or null.
   * @returns Returns the skills in scope, by name.
   */
  public async offer(
    surface: AgentSurface,
    language: string | null,
  ): Promise<readonly OfferedSkill[]> {
    const skills: readonly Skill[] = await this.list();
    return skills
      .filter(
        (skill: Skill): boolean =>
          skill.enabled && skill.problem === null && scopeMatches(skill.scope, surface, language),
      )
      .map((skill: Skill): OfferedSkill => ({
        name: skill.name,
        description: skill.description,
        load: async (): Promise<{ body: string; files: readonly string[] } | null> => {
          const current: Skill | null = await this.read(skill.name);
          return current === null
            ? null
            : {
                body: current.body,
                files: current.files.map((file: string): string => join(current.directory, file)),
              };
        },
      }));
  }

  /**
   * Resolves a skill folder, refusing any name that would leave the library.
   * @param name The folder name.
   * @returns Returns the absolute path, or null for a name that is not a plain folder name.
   */
  public folderOf(name: string): string | null {
    if (!SKILL_NAME_PATTERN.test(name)) {
      return null;
    }
    const directory: string = resolve(this.root, name);
    return directory.startsWith(`${resolve(this.root)}${sep}`) ? directory : null;
  }

  /**
   * Lists the files bundled beside a skill's `SKILL.md`, relative to its folder.
   * @param directory The skill folder.
   * @returns Returns the relative paths, capped at {@link BUNDLED_FILE_LIMIT}.
   */
  private async bundledFiles(directory: string): Promise<readonly string[]> {
    const found: string[] = [];
    const walk: (folder: string) => Promise<void> = async (folder: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (found.length >= BUNDLED_FILE_LIMIT) {
          return;
        }
        if (IGNORED_ENTRIES.includes(entry.name)) {
          continue;
        }
        const path: string = join(folder, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
        } else if (entry.isFile() && !(folder === directory && entry.name === SKILL_FILE)) {
          found.push(relative(directory, path));
        }
      }
    };
    await walk(directory);
    return found.sort();
  }

  /**
   * Reads a text file, or null when it cannot be read.
   * @param path The file path.
   * @returns Returns the text, or null.
   */
  private async readText(path: string): Promise<string | null> {
    try {
      return await fs.readFile(path, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Determines whether a path exists.
   * @param path The path.
   * @returns Returns true when something is there.
   */
  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
