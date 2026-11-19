import type { PromptScope } from './ai/ai-prompt-scope';
import { slugify, uniqueName } from './library-names';

// Shared contract for the user's persona (#1513, #1514), between the Electron (back-end) and Angular
// (front-end) processes. A persona is a model of the user: a short core the agent is always given,
// and many small memories it looks up when they are relevant. Each entry is one Markdown file in a
// folder Studio owns under its user-data path, as prompt profiles and skills are, so the persona can
// be read and edited with any tool and backed up by copying a folder. It replaces prompt profiles: a
// profile is an entry the user wrote, in the core, locked.
// Keep this module platform-neutral (types and pure functions only).

/**
 * The IPC channels of the persona store.
 */
export enum PersonaChannel {
  /**
   * Lists every entry, converting the user's prompt profiles on the first call after personas shipped.
   */
  List = 'persona:list',

  /**
   * Creates or replaces an entry's file.
   */
  Save = 'persona:save',

  /**
   * Deletes an entry's file.
   */
  Delete = 'persona:delete',

  /**
   * Opens the persona folder in the platform file manager, creating it first when missing.
   */
  OpenFolder = 'persona:open-folder',

  /**
   * Main → renderer: the persona changed, so every window re-reads it.
   */
  Changed = 'persona:changed',
}

/**
 * Which half of the persona an entry is in. The core is given to the agent at the start of every
 * session, so it is kept small; a memory is found by searching, so there can be many.
 */
export type PersonaLayer = 'core' | 'memory';

/**
 * Who wrote an entry: the user, or persona learning, which learns the persona in the background (#1516).
 */
export type PersonaAuthor = 'user' | 'learned';

/**
 * One thing about the user: how they like replies written, a decision they have made, a question
 * they have answered, something they keep correcting.
 *
 * 🔑 An entry stands on its own. It carries everything it needs and never points back at the
 * conversation it was learned from, so deleting conversations (which Studio does on a schedule) never
 * touches the persona.
 */
export interface PersonaEntry {
  /**
   * Gets the stable identifier, which is also the entry's file name without `.md`.
   */
  readonly id: string;

  /**
   * Gets the short title: what the entry is called in the Persona page, and the heading of its part
   * of the core in the agent's instructions.
   */
  readonly name: string;

  /**
   * Gets what the entry says about the user.
   */
  readonly text: string;

  /**
   * Gets why it is true, when known, or empty. A reason predicts what was never discussed: "avoids
   * flying because of the carbon cost" says something about trains that "avoids flying" does not.
   */
  readonly why: string;

  /**
   * Gets the tags a search finds the entry by, lower-case.
   */
  readonly tags: readonly string[];

  /**
   * Gets the ids of related entries, so the persona is a graph rather than a tree.
   */
  readonly links: readonly string[];

  /**
   * Gets where the entry applies: the surfaces and languages a prompt profile was scoped to.
   */
  readonly scope: PromptScope;

  /**
   * Gets which half of the persona the entry is in.
   */
  readonly layer: PersonaLayer;

  /**
   * Gets whether the entry is used. A switched-off entry is kept but never given to the agent.
   */
  readonly enabled: boolean;

  /**
   * Gets how sure persona learning is that the entry is right, from 0 to 1. An entry the user wrote is 1.
   */
  readonly confidence: number;

  /**
   * Gets the day the entry was last confirmed (`YYYY-MM-DD`), or empty when never. Unconfirmed
   * entries fade over time (#1519).
   */
  readonly confirmed: string;

  /**
   * Gets who wrote the entry.
   */
  readonly author: PersonaAuthor;

  /**
   * Gets whether the entry is locked: PersonaLearning never changes or removes a locked entry.
   */
  readonly locked: boolean;
}

/**
 * What a list returns.
 */
export interface PersonaListing {
  /**
   * Gets the entries, in id order.
   */
  readonly entries: readonly PersonaEntry[];

  /**
   * Gets how many prompt profiles were converted into the persona when it was first created, or 0.
   * Kept in the store rather than reported once, so the one-off notice can be shown by whichever
   * window first gets to it.
   */
  readonly convertedProfiles: number;

  /**
   * Gets whether the persona folder existed before this call. False on the first launch of a build
   * with personas, which is the renderer's cue to convert profiles kept in the settings store by
   * builds older than profile files (#1263).
   */
  readonly existed: boolean;
}

/**
 * About how many lines the core may hold. It is read at the start of every session, so every line is
 * paid for on every turn; past this, the Persona page warns and persona learning merges and trims (#1516).
 */
export const PERSONA_CORE_LINE_LIMIT: number = 12;

/**
 * Matches a valid entry id: a safe path segment, so the id doubles as the file name.
 */
export const PERSONA_ENTRY_ID_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * The most characters an entry's text may carry: generous, because a converted prompt profile may be
 * long, but bounded because the renderer is untrusted and an unbounded string is a way to fill the disk.
 */
export const PERSONA_TEXT_LIMIT: number = 64 * 1024;

/**
 * The most tags or links one entry may carry.
 */
export const PERSONA_LIST_LIMIT: number = 32;

/**
 * Picks the id a new entry is filed under: its name slugged, made unique against the ids in use.
 * @param name The entry's name.
 * @param taken The ids already in use.
 * @returns Returns the id.
 */
export function personaIdFor(name: string, taken: readonly string[]): string {
  const used: ReadonlySet<string> = new Set(taken);
  return uniqueName(slugify(name) || 'entry', (id: string): boolean => used.has(id));
}

/**
 * Normalises a tag: lower-case, trimmed, inner runs of space made one hyphen, a leading `#` dropped.
 * Kept loose otherwise, because `c#` and `c++` are tags people use.
 * @param tag The tag as written.
 * @returns Returns the tag, or empty when nothing usable is left.
 */
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[,[\]"]/g, '')
    .slice(0, 48);
}

/**
 * Normalises a list of tags: each one normalised, blanks and repeats dropped, bounded.
 * @param tags The tags as written.
 * @returns Returns the tags.
 */
export function normalizeTags(tags: readonly string[]): readonly string[] {
  const seen: Set<string> = new Set<string>();
  for (const tag of tags) {
    const normal: string = normalizeTag(tag);
    if (normal.length > 0) {
      seen.add(normal);
    }
  }
  return [...seen].slice(0, PERSONA_LIST_LIMIT);
}

/**
 * Clamps a confidence into 0–1, reading anything that is not a finite number as certain.
 * @param value The confidence.
 * @returns Returns the clamped confidence.
 */
export function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
}

/**
 * Counts the lines an entry adds to the core: its non-blank text lines, plus one for a reason.
 * @param entry The entry.
 * @returns Returns the count.
 */
export function coreLinesOf(entry: PersonaEntry): number {
  const text: number = entry.text
    .split('\n')
    .filter((line: string): boolean => line.trim().length > 0).length;
  return text + (entry.why.trim().length > 0 ? 1 : 0);
}

/**
 * Counts the lines the whole core takes: every enabled core entry, whatever its scope, because the
 * limit is about what the user has put there rather than what one particular turn receives.
 * @param entries The persona's entries.
 * @returns Returns the count.
 */
export function coreLineCount(entries: readonly PersonaEntry[]): number {
  return entries
    .filter((entry: PersonaEntry): boolean => entry.enabled && entry.layer === 'core')
    .reduce((total: number, entry: PersonaEntry): number => total + coreLinesOf(entry), 0);
}

/**
 * Determines whether an entry, on its own, is longer than the whole core may be. Such an entry (a long
 * converted profile, say) is kept as it is and flagged: nothing is ever cut automatically.
 * @param entry The entry.
 * @returns Returns true when it is over the limit.
 */
export function isOverCoreLimit(entry: PersonaEntry): boolean {
  return entry.layer === 'core' && coreLinesOf(entry) > PERSONA_CORE_LINE_LIMIT;
}

/**
 * Determines whether an entry matches what the user typed into the Persona page's search: `#tag`
 * matches that tag exactly, anything else matches the name, the text, the reason or a tag.
 * @param entry The entry.
 * @param query The search text.
 * @returns Returns true when it matches, or when there is nothing to match.
 */
export function personaEntryMatches(entry: PersonaEntry, query: string): boolean {
  const text: string = query.trim().toLowerCase();
  if (text.length === 0) {
    return true;
  }
  if (text.startsWith('#')) {
    const tag: string = normalizeTag(text);
    return tag.length === 0 || entry.tags.includes(tag);
  }
  return (
    entry.name.toLowerCase().includes(text) ||
    entry.text.toLowerCase().includes(text) ||
    entry.why.toLowerCase().includes(text) ||
    entry.tags.some((tag: string): boolean => tag.includes(text))
  );
}

/**
 * Today's date as an entry records it.
 * @param now The moment.
 * @returns Returns `YYYY-MM-DD`.
 */
export function personaDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
