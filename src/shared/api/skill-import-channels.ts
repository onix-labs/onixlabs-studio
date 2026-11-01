import type { PromptScope } from './ai/ai-prompt-scope';
import type { PromptProfile } from './prompt-profile-channels';

// Shared contract for bringing skills and prompt profiles into Studio's libraries and taking them out
// again (#1263), between the Electron (back-end) and Angular (front-end) processes. The main process
// reads the chosen folder (never writing to it), drafts every candidate and holds the plan; the
// renderer walks the user through it one file at a time, may hand files to an AI, and sends back what
// was accepted, which the main process writes all at once or not at all. Keep this module
// platform-neutral (types and constants only).

/**
 * The IPC channels of import and export.
 */
export enum SkillImportChannel {
  /**
   * Asks for a folder or file through the platform dialog and scans it into a plan; null when the
   * dialog was cancelled.
   */
  Choose = 'skill-import:choose',

  /**
   * Writes the accepted part of a plan to the libraries, all or nothing.
   */
  Commit = 'skill-import:commit',

  /**
   * Forgets a plan the user cancelled, so the main process stops holding it.
   */
  Discard = 'skill-import:discard',

  /**
   * Asks for a destination through the platform dialog and exports both libraries there.
   */
  Export = 'skill-import:export',
}

/**
 * The value an export's `manifest.json` carries under `format`, which is how an import recognises one.
 */
export const LIBRARY_EXPORT_FORMAT: string = 'onixlabs-studio-ai-library';

/**
 * The export layout's version, written to the manifest.
 */
export const LIBRARY_EXPORT_VERSION: number = 1;

/**
 * How a plan treats what it found:
 * - `convert`: plain Markdown files, possibly with no frontmatter at all, turned into skills — the
 *   user is asked about each one and may have an AI help.
 * - `restore`: an export, or a folder of `SKILL.md` folders, already in the library's own format —
 *   brought back with no AI and no questions beyond name clashes.
 */
export type SkillImportKind = 'convert' | 'restore';

/**
 * Whether a candidate can go straight in:
 * - `ready`: it can be imported as drafted.
 * - `needs-ai`: something is missing that a person or an AI must supply (see the entry's reason).
 * - `not-a-skill`: it looks like a README, licence or other repository file rather than a skill.
 */
export type SkillImportStatus = 'ready' | 'needs-ai' | 'not-a-skill';

/**
 * The editable half of a candidate: what would be written to the skill's `SKILL.md`.
 */
export interface SkillImportDraft {
  /**
   * Gets the name the skill would be filed under.
   */
  readonly name: string;

  /**
   * Gets the description, possibly empty when none could be drafted.
   */
  readonly description: string;

  /**
   * Gets where the skill applies.
   */
  readonly scope: PromptScope;

  /**
   * Gets the technology ids.
   */
  readonly technologies: readonly string[];

  /**
   * Gets whether the skill would be offered to agents.
   */
  readonly enabled: boolean;

  /**
   * Gets the Markdown body, its links still as the source wrote them; they are rewritten to the
   * library's layout when the plan is committed, once every final name is known.
   */
  readonly body: string;
}

/**
 * One file the scan found.
 */
export interface SkillImportEntry {
  /**
   * Gets the file's path relative to the chosen folder, with `/` separators; the entry's identity
   * within the plan.
   */
  readonly source: string;

  /**
   * Gets whether it can go straight in.
   */
  readonly status: SkillImportStatus;

  /**
   * Gets why it cannot, or null when it is ready.
   */
  readonly reason: string | null;

  /**
   * Gets the drafted skill.
   */
  readonly draft: SkillImportDraft;

  /**
   * Gets the paths of the files that come with it (a `SKILL.md` folder's other files), relative to its
   * folder; empty for a lone Markdown file.
   */
  readonly bundled: readonly string[];
}

/**
 * What a scan produced.
 */
export interface SkillImportPlan {
  /**
   * Gets the plan's id, which the commit and discard name.
   */
  readonly id: string;

  /**
   * Gets the absolute path that was chosen, shown to the user.
   */
  readonly root: string;

  /**
   * Gets how the plan treats what it found.
   */
  readonly kind: SkillImportKind;

  /**
   * Gets the skill candidates, in path order.
   */
  readonly entries: readonly SkillImportEntry[];

  /**
   * Gets the prompt profiles found in an export; empty otherwise.
   */
  readonly profiles: readonly PromptProfile[];

  /**
   * Gets the names of the skills already in the library, for clash checks.
   */
  readonly existingSkills: readonly string[];

  /**
   * Gets the ids of the profiles already in the library, for clash checks.
   */
  readonly existingProfiles: readonly string[];
}

/**
 * One accepted skill.
 */
export interface SkillImportAcceptedSkill {
  /**
   * Gets the entry's source path within the plan.
   */
  readonly source: string;

  /**
   * Gets what to write.
   */
  readonly draft: SkillImportDraft;

  /**
   * Gets whether it replaces the library skill of the same name.
   */
  readonly replace: boolean;
}

/**
 * One accepted profile.
 */
export interface SkillImportAcceptedProfile {
  /**
   * Gets the profile to write, under its (possibly renamed) id.
   */
  readonly profile: PromptProfile;

  /**
   * Gets whether it replaces the library profile with the same id.
   */
  readonly replace: boolean;
}

/**
 * What the renderer sends to commit a plan.
 */
export interface SkillImportCommit {
  /**
   * Gets the plan's id.
   */
  readonly planId: string;

  /**
   * Gets the accepted skills.
   */
  readonly skills: readonly SkillImportAcceptedSkill[];

  /**
   * Gets the accepted profiles.
   */
  readonly profiles: readonly SkillImportAcceptedProfile[];
}

/**
 * The outcome of a commit.
 */
export interface SkillImportResult {
  /**
   * Gets how many skills were written.
   */
  readonly skills: number;

  /**
   * Gets how many profiles were written.
   */
  readonly profiles: number;

  /**
   * Gets how many links between imported files were rewritten to the library's layout.
   */
  readonly linksRewritten: number;

  /**
   * Gets why nothing was written, or null on success.
   */
  readonly error: string | null;
}

/**
 * The outcome of an export.
 */
export interface SkillExportResult {
  /**
   * Gets the folder written, or null when the dialog was cancelled or the export failed.
   */
  readonly folder: string | null;

  /**
   * Gets how many skills were exported.
   */
  readonly skills: number;

  /**
   * Gets how many profiles were exported.
   */
  readonly profiles: number;

  /**
   * Gets why the export failed, or null.
   */
  readonly error: string | null;
}
