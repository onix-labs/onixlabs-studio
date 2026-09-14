import type { PromptScope } from './ai/ai-prompt-scope';

// Shared contract for the skill library (#301), between the Electron (back-end) and Angular
// (front-end) processes. A skill is a folder on disk holding a `SKILL.md` — YAML frontmatter naming
// and describing it, a Markdown body carrying the instructions — and any files it bundles. The library
// is a directory Studio owns under its user-data path; the main process reads and writes it, and the
// renderer edits through these channels. Keep this module platform-neutral (types and constants only —
// no Node or DOM dependencies) so both compilation targets can import it.
//
// 🔑 The on-disk format is the one the Claude Agent SDK discovers natively (`SKILL.md` with `name` and
// `description` in the frontmatter), so a skill authored here is portable to any tool that reads that
// layout, and one written elsewhere can be dropped into the library. Studio's own keys — the scope and
// the enabled flag — sit beside those two in the same frontmatter, where a reader that does not know
// them ignores them.

/**
 * The IPC channels of the skill library.
 */
export enum SkillChannel {
  /**
   * Lists every skill in the library.
   */
  List = 'skill:list',

  /**
   * Creates or replaces a skill from a draft.
   */
  Save = 'skill:save',

  /**
   * Deletes a skill's folder.
   */
  Delete = 'skill:delete',

  /**
   * Reveals a skill's folder in the platform file manager.
   */
  Reveal = 'skill:reveal',

  /**
   * Reveals the library folder itself, for a user who would rather work on disk.
   */
  OpenLibrary = 'skill:open-library',

  /**
   * Copies a `SKILL.md` — or a folder holding one — chosen through the platform dialog into the library.
   */
  Import = 'skill:import',
}

/**
 * The name of the file a skill folder must hold.
 */
export const SKILL_FILE: string = 'SKILL.md';

/**
 * Matches a valid skill name: lower-case letters, digits and hyphens, as the SDK's own convention has
 * it. It doubles as the folder name, so it is deliberately no wider than a safe path segment.
 */
export const SKILL_NAME_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * The most characters a skill's description may carry. The description is what every in-scope skill
 * costs on every turn — it is listed in the system prompt so the model can decide whether to load the
 * body — so it is bounded where the body is not.
 */
export const SKILL_DESCRIPTION_LIMIT: number = 1024;

/**
 * A skill as the library holds it.
 */
export interface Skill {
  /**
   * Gets the skill's name, which is also its folder's.
   */
  readonly name: string;

  /**
   * Gets the one-paragraph description the model reads to decide whether the skill applies.
   */
  readonly description: string;

  /**
   * Gets where the skill applies.
   */
  readonly scope: PromptScope;

  /**
   * Gets whether the skill is offered to agents at all. A disabled skill stays on disk and in the
   * library view, and is simply never listed to a model.
   */
  readonly enabled: boolean;

  /**
   * Gets the Markdown body: the instructions a model receives when it loads the skill.
   */
  readonly body: string;

  /**
   * Gets the absolute path of the skill's folder.
   */
  readonly directory: string;

  /**
   * Gets the paths of the files bundled beside `SKILL.md`, relative to {@link directory}. Empty when
   * the skill is the one file.
   */
  readonly files: readonly string[];

  /**
   * Gets why the skill cannot be offered, or null when it can. A folder whose `SKILL.md` has no
   * description, for example, is listed so the user can fix it rather than silently skipped.
   */
  readonly problem: string | null;
}

/**
 * What the renderer sends to create or update a skill.
 */
export interface SkillDraft {
  /**
   * Gets the name to save under.
   */
  readonly name: string;

  /**
   * Gets the name the skill currently has, when saving renames it; undefined to create or replace
   * in place.
   */
  readonly previousName?: string;

  /**
   * Gets the description.
   */
  readonly description: string;

  /**
   * Gets where the skill applies.
   */
  readonly scope: PromptScope;

  /**
   * Gets whether the skill is offered to agents.
   */
  readonly enabled: boolean;

  /**
   * Gets the Markdown body.
   */
  readonly body: string;
}

/**
 * The outcome of a save: the stored skill, or the reason it was refused.
 */
export interface SkillSaveResult {
  /**
   * Gets the stored skill, or null when the draft was refused.
   */
  readonly skill: Skill | null;

  /**
   * Gets the reason the draft was refused, or null on success.
   */
  readonly error: string | null;
}

/**
 * The client contract the renderer's skill service implements over the bridge.
 */
export interface SkillClient {
  /**
   * Lists every skill in the library.
   * @returns Returns the skills, sorted by name.
   */
  list(): Promise<readonly Skill[]>;

  /**
   * Creates or updates a skill.
   * @param draft The draft to store.
   * @returns Returns the outcome.
   */
  save(draft: SkillDraft): Promise<SkillSaveResult>;

  /**
   * Deletes a skill.
   * @param name The skill's name.
   * @returns Resolves when the folder is gone.
   */
  delete(name: string): Promise<void>;

  /**
   * Reveals a skill's folder in the file manager.
   * @param name The skill's name.
   * @returns Resolves once the request is issued.
   */
  reveal(name: string): Promise<void>;

  /**
   * Reveals the library folder in the file manager.
   * @returns Resolves once the request is issued.
   */
  openLibrary(): Promise<void>;

  /**
   * Imports a skill chosen through the platform dialog.
   * @returns Returns the outcome, or null when the dialog was cancelled.
   */
  import(): Promise<SkillSaveResult | null>;
}
