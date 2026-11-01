import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PromptProfile, PromptProfileListing } from '@shared/api/prompt-profile-channels';
import { serializeProfileFile } from '@shared/api/prompt-profile-file';
import { SKILL_FILE, SKILL_NAME_PATTERN, type Skill } from '@shared/api/skill-channels';
import { parseSkillFile, serializeSkillFile, skillProblem } from '@shared/api/skill-file';
import {
  LIBRARY_EXPORT_FORMAT,
  LIBRARY_EXPORT_VERSION,
  type SkillExportResult,
  type SkillImportAcceptedSkill,
  type SkillImportCommit,
  type SkillImportEntry,
  type SkillImportPlan,
  type SkillImportResult,
} from '@shared/api/skill-import-channels';
import { logger } from '@shared/electron/logger';
import type { PromptProfileLibrary } from '../prompt-profiles/prompt-profile-library';
import {
  rewriteSkillLinks,
  commonFolder,
  scanSelection,
  type ScannedEntry,
  type ScannedFolder,
} from './skill-import-scan';
import type { SkillLibrary } from './skill-library';

/**
 * A plan the renderer is walking the user through, with what only the main process may know.
 */
interface HeldPlan {
  /**
   * Gets the plan as the renderer was given it.
   */
  readonly plan: SkillImportPlan;

  /**
   * Gets the scanned entries by source, carrying the folders their bundled files are copied from.
   */
  readonly entries: ReadonlyMap<string, ScannedEntry>;
}

/**
 * The most plans held at once. A plan is dropped when it is committed or discarded; this bounds a
 * renderer that does neither.
 */
const HELD_PLAN_LIMIT: number = 4;

/**
 * Moves skills and prompt profiles into and out of Studio's libraries (#1263).
 *
 * 🔑 A commit is all or nothing. Every accepted skill is written to a staging folder beside the
 * library first; only when all of them are there are replaced skills moved aside and the staged ones
 * moved in, and a failure at any point puts back what was moved. Cancelling an import therefore never
 * has to undo anything, and a failed one leaves the library as it was.
 */
export class LibraryTransfer {
  /**
   * Holds the plans by id.
   */
  private readonly plans: Map<string, HeldPlan> = new Map<string, HeldPlan>();

  /**
   * Initializes a new instance of the {@link LibraryTransfer} class.
   * @param skills The skill library.
   * @param profiles The prompt-profile library.
   */
  public constructor(
    private readonly skills: SkillLibrary,
    private readonly profiles: PromptProfileLibrary,
  ) {}

  /**
   * Scans what the user picked — one file or folder, or several — into a plan, and holds it until it
   * is committed or discarded.
   * @param picked The absolute path picked, or the paths.
   * @returns Returns the plan.
   */
  public async scan(picked: string | readonly string[]): Promise<SkillImportPlan> {
    const paths: readonly string[] = typeof picked === 'string' ? [picked] : picked;
    const found: ScannedFolder = await scanSelection(paths);
    const path: string = paths.length === 1 ? paths[0] : commonFolder(paths);
    const existingSkills: readonly string[] = (await this.skills.list()).map(
      (skill: Skill): string => skill.name,
    );
    const listing: PromptProfileListing = await this.profiles.list();
    const plan: SkillImportPlan = {
      id: randomUUID(),
      root: path,
      kind: found.kind,
      // The folders stay here: the renderer names an entry by its source, never by a path.
      entries: found.entries.map((entry: ScannedEntry): SkillImportEntry => ({
        source: entry.source,
        status: entry.status,
        reason: entry.reason,
        draft: entry.draft,
        bundled: entry.bundled,
      })),
      profiles: found.profiles,
      existingSkills,
      existingProfiles: listing.profiles.map((profile: PromptProfile): string => profile.id),
    };
    while (this.plans.size >= HELD_PLAN_LIMIT) {
      this.plans.delete(this.plans.keys().next().value!);
    }
    this.plans.set(plan.id, {
      plan,
      entries: new Map(
        found.entries.map((entry: ScannedEntry): [string, ScannedEntry] => [entry.source, entry]),
      ),
    });
    logger.info(
      'LibraryTransfer.scan',
      `Scanned ${path}: ${plan.kind}, ${plan.entries.length} skill candidate(s), ${plan.profiles.length} profile(s)${found.truncated ? ' (truncated)' : ''}`,
    );
    return plan;
  }

  /**
   * Forgets a plan.
   * @param planId The plan's id.
   */
  public discard(planId: string): void {
    this.plans.delete(planId);
  }

  /**
   * Writes the accepted part of a plan, all or nothing.
   * @param commit What was accepted.
   * @returns Returns how much was written, or why nothing was.
   */
  public async commit(commit: SkillImportCommit): Promise<SkillImportResult> {
    const held: HeldPlan | undefined = this.plans.get(commit.planId);
    const failed: (error: string) => SkillImportResult = (error: string): SkillImportResult => ({
      skills: 0,
      profiles: 0,
      linksRewritten: 0,
      error,
    });
    if (held === undefined) {
      return failed('The import has expired; start it again.');
    }
    const problem: string | null = this.validate(held, commit);
    if (problem !== null) {
      return failed(problem);
    }
    const nameBySource: Map<string, string> = new Map<string, string>(
      commit.skills.map((accepted: SkillImportAcceptedSkill): [string, string] => [
        accepted.source,
        accepted.draft.name,
      ]),
    );
    const root: string = this.skills.directory;
    const staging: string = `${root}.staging-${commit.planId}`;
    const backup: string = `${root}.backup-${commit.planId}`;
    const movedIn: string[] = [];
    const movedAside: string[] = [];
    const profileBackups: Map<string, string | null> = new Map<string, string | null>();
    let linksRewritten: number = 0;
    try {
      await fs.mkdir(staging, { recursive: true });
      for (const accepted of commit.skills) {
        const scanned: ScannedEntry = held.entries.get(accepted.source)!;
        const target: string = join(staging, accepted.draft.name);
        if (scanned.folder !== null) {
          await fs.cp(scanned.folder, target, {
            recursive: true,
            filter: (path: string): boolean => !/[\\/](\.git|node_modules|\.DS_Store)$/.test(path),
          });
        } else {
          await fs.mkdir(target, { recursive: true });
        }
        const links: { body: string; rewritten: number } =
          held.plan.kind === 'convert'
            ? rewriteSkillLinks(accepted.draft.body, accepted.source, nameBySource)
            : { body: accepted.draft.body, rewritten: 0 };
        linksRewritten += links.rewritten;
        // Keys another tool wrote (an `allowed-tools` line, say) come across with a copied folder.
        const copied: string | null = await readOrNull(join(target, SKILL_FILE));
        await fs.writeFile(
          join(target, SKILL_FILE),
          serializeSkillFile({
            ...accepted.draft,
            body: links.body,
            foreignLines: copied === null ? [] : parseSkillFile(copied).foreignLines,
          }),
          'utf8',
        );
      }
      await fs.mkdir(root, { recursive: true });
      for (const accepted of commit.skills) {
        const target: string = join(root, accepted.draft.name);
        if (accepted.replace && (await exists(target))) {
          await fs.mkdir(backup, { recursive: true });
          await fs.rename(target, join(backup, accepted.draft.name));
          movedAside.push(accepted.draft.name);
        }
        await fs.rename(join(staging, accepted.draft.name), target);
        movedIn.push(accepted.draft.name);
      }
      for (const accepted of commit.profiles) {
        const path: string = this.profiles.fileOf(accepted.profile.id)!;
        profileBackups.set(path, await readOrNull(path));
        const error: string | null = await this.profiles.save(accepted.profile);
        if (error !== null) {
          throw new Error(error);
        }
      }
    } catch (error: unknown) {
      logger.warn('LibraryTransfer.commit', 'Import failed; rolling back', error);
      await this.rollBack(root, backup, movedIn, movedAside, profileBackups);
      await fs.rm(staging, { recursive: true, force: true });
      return failed('The import could not be written, so nothing was changed.');
    }
    await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(backup, { recursive: true, force: true });
    this.plans.delete(commit.planId);
    logger.info(
      'LibraryTransfer.commit',
      `Imported ${commit.skills.length} skill(s), ${commit.profiles.length} profile(s), ${linksRewritten} link(s) rewritten`,
    );
    return {
      skills: commit.skills.length,
      profiles: commit.profiles.length,
      linksRewritten,
      error: null,
    };
  }

  /**
   * Exports both libraries into a new folder inside the one chosen.
   * @param parent The folder chosen.
   * @param now The export's time, for the folder name and manifest.
   * @returns Returns the folder written and the counts.
   */
  public async export(parent: string, now: Date = new Date()): Promise<SkillExportResult> {
    const stamp: string = now.toISOString().slice(0, 10);
    let folder: string = join(parent, `ONIXLabs Studio AI Library ${stamp}`);
    for (let attempt: number = 2; await exists(folder); attempt += 1) {
      folder = join(parent, `ONIXLabs Studio AI Library ${stamp} (${attempt})`);
    }
    const skills: readonly Skill[] = await this.skills.list();
    const listing: PromptProfileListing = await this.profiles.list();
    try {
      await fs.mkdir(join(folder, 'skills'), { recursive: true });
      await fs.mkdir(join(folder, 'profiles'), { recursive: true });
      for (const skill of skills) {
        await fs.cp(skill.directory, join(folder, 'skills', skill.name), { recursive: true });
      }
      for (const profile of listing.profiles) {
        await fs.writeFile(
          join(folder, 'profiles', `${profile.id}.md`),
          serializeProfileFile(profile),
          'utf8',
        );
      }
      await fs.writeFile(
        join(folder, 'manifest.json'),
        `${JSON.stringify(
          {
            format: LIBRARY_EXPORT_FORMAT,
            version: LIBRARY_EXPORT_VERSION,
            exported: now.toISOString(),
            skills: skills.length,
            profiles: listing.profiles.length,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch (error: unknown) {
      logger.warn('LibraryTransfer.export', `Could not export to ${folder}`, error);
      await fs.rm(folder, { recursive: true, force: true });
      return {
        folder: null,
        skills: 0,
        profiles: 0,
        error: 'The library could not be exported there.',
      };
    }
    logger.info(
      'LibraryTransfer.export',
      `Exported ${skills.length} skill(s), ${listing.profiles.length} profile(s) to ${folder}`,
    );
    return { folder, skills: skills.length, profiles: listing.profiles.length, error: null };
  }

  /**
   * Checks a commit against its plan and the libraries before anything is written.
   * @param held The plan.
   * @param commit The commit.
   * @returns Returns the first problem, or null.
   */
  private validate(held: HeldPlan, commit: SkillImportCommit): string | null {
    const names: Set<string> = new Set<string>();
    const existing: ReadonlySet<string> = new Set(held.plan.existingSkills);
    for (const accepted of commit.skills) {
      if (!held.entries.has(accepted.source)) {
        return `"${accepted.source}" is not part of this import.`;
      }
      const problem: string | null = skillProblem(accepted.draft.name, accepted.draft.description);
      if (problem !== null) {
        return `${accepted.source}: ${problem}`;
      }
      if (names.has(accepted.draft.name)) {
        return `Two files would both be named "${accepted.draft.name}".`;
      }
      if (existing.has(accepted.draft.name) && !accepted.replace) {
        return `A skill named "${accepted.draft.name}" already exists.`;
      }
      names.add(accepted.draft.name);
    }
    const ids: Set<string> = new Set<string>();
    const existingProfiles: ReadonlySet<string> = new Set(held.plan.existingProfiles);
    for (const accepted of commit.profiles) {
      if (
        this.profiles.fileOf(accepted.profile.id) === null ||
        !SKILL_NAME_PATTERN.test(accepted.profile.id)
      ) {
        return `The profile id "${accepted.profile.id}" is not a valid file name.`;
      }
      if (ids.has(accepted.profile.id)) {
        return `Two profiles would both be filed as "${accepted.profile.id}".`;
      }
      if (existingProfiles.has(accepted.profile.id) && !accepted.replace) {
        return `A profile filed as "${accepted.profile.id}" already exists.`;
      }
      ids.add(accepted.profile.id);
    }
    return null;
  }

  /**
   * Puts the libraries back as they were before a failed commit.
   * @param root The skill library.
   * @param backup Where replaced skills were moved aside to.
   * @param movedIn The skills moved into the library.
   * @param movedAside The skills moved aside.
   * @param profileBackups The profile files written, with what they held before (null when new).
   */
  private async rollBack(
    root: string,
    backup: string,
    movedIn: readonly string[],
    movedAside: readonly string[],
    profileBackups: ReadonlyMap<string, string | null>,
  ): Promise<void> {
    for (const name of movedIn) {
      await fs.rm(join(root, name), { recursive: true, force: true }).catch((): void => undefined);
    }
    for (const name of movedAside) {
      await fs.rename(join(backup, name), join(root, name)).catch((error: unknown): void => {
        logger.error('LibraryTransfer.rollBack', `Could not restore skill "${name}"`, error);
      });
    }
    await fs.rm(backup, { recursive: true, force: true }).catch((): void => undefined);
    for (const [path, previous] of profileBackups) {
      await (
        previous === null ? fs.rm(path, { force: true }) : fs.writeFile(path, previous, 'utf8')
      ).catch((error: unknown): void => {
        logger.error('LibraryTransfer.rollBack', `Could not restore profile ${path}`, error);
      });
    }
  }
}

/**
 * Determines whether a path exists.
 * @param path The path.
 * @returns Returns true when something is there.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a file, or null when there is none.
 * @param path The path.
 * @returns Returns the text, or null.
 */
async function readOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}
