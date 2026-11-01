import type { PromptScope } from './ai/ai-prompt-scope';

// Shared contract for the prompt-profile library (#300, #1263), between the Electron (back-end) and
// Angular (front-end) processes. A profile is one Markdown file in a folder Studio owns under its
// user-data path — frontmatter naming and scoping it, the body carrying the instructions — so the
// profiles can be edited with any tool and backed up by copying a folder, as the skill library can.
// Keep this module platform-neutral (types and pure functions only).

/**
 * The IPC channels of the prompt-profile library.
 */
export enum PromptProfileChannel {
  /**
   * Lists every profile, and whether the library folder existed before the call.
   */
  List = 'prompt-profile:list',

  /**
   * Creates or replaces a profile's file.
   */
  Save = 'prompt-profile:save',

  /**
   * Deletes a profile's file.
   */
  Delete = 'prompt-profile:delete',

  /**
   * Opens the library folder in the platform file manager, creating it first when missing.
   */
  OpenFolder = 'prompt-profile:open-folder',

  /**
   * Main → renderer: the library changed, so every window re-reads it.
   */
  Changed = 'prompt-profile:changed',
}

/**
 * A prompt profile (#300): standing instructions the user wants every matching agent turn to carry,
 * appended to Studio's own. Free-form; "context, conventions, guardrails" are all just prompt text
 * here. Where a skill is loaded only when the agent judges it relevant, a profile always applies.
 */
export interface PromptProfile {
  /**
   * Gets the stable identifier, which is also the profile's file name without `.md`.
   */
  readonly id: string;

  /**
   * Gets the display name, which also heads the profile's section in the composed prompt so the
   * model can tell one standing instruction from another.
   */
  readonly name: string;

  /**
   * Gets where the profile applies.
   */
  readonly scope: PromptScope;

  /**
   * Gets the standing instructions, or empty for none.
   */
  readonly instructions: string;

  /**
   * Gets whether the profile is applied. A disabled profile is kept but never composed, so a user can
   * park one without losing it.
   */
  readonly enabled: boolean;
}

/**
 * What a list returns.
 */
export interface PromptProfileListing {
  /**
   * Gets the profiles, in file-name order.
   */
  readonly profiles: readonly PromptProfile[];

  /**
   * Gets whether the library folder existed before this call. False on the first launch after
   * profiles moved to files, which is the renderer's cue to migrate the ones it kept in the
   * settings store.
   */
  readonly existed: boolean;
}

/**
 * Matches a valid profile id: the same safe path segment a skill name is, so the id doubles as the
 * file name.
 */
export const PROMPT_PROFILE_ID_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Turns free text into a path-safe slug: lower-case letters, digits and single hyphens, at most 64
 * characters, or empty when nothing usable is left.
 * @param text The text to slug.
 * @returns Returns the slug.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/**
 * Picks a name not already taken: the base itself, else the base with the first free `-2`, `-3`…
 * suffix, shortened so the result still fits a 64-character path segment.
 * @param base The preferred name; assumed already slugged.
 * @param taken Returns true for a name already in use.
 * @returns Returns the free name.
 */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
  const root: string = base.length === 0 ? 'untitled' : base;
  if (!taken(root)) {
    return root;
  }
  for (let suffix: number = 2; ; suffix += 1) {
    const tail: string = `-${suffix}`;
    const candidate: string = `${root.slice(0, 64 - tail.length).replace(/-+$/g, '')}${tail}`;
    if (!taken(candidate)) {
      return candidate;
    }
  }
}

/**
 * Picks the id a new profile is filed under: its name slugged, made unique against the ids in use.
 * @param name The profile's display name.
 * @param taken The ids already in use.
 * @returns Returns the id.
 */
export function profileIdFor(name: string, taken: readonly string[]): string {
  const used: ReadonlySet<string> = new Set(taken);
  return uniqueName(slugify(name) || 'profile', (id: string): boolean => used.has(id));
}
