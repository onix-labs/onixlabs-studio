import { AGENT_SURFACES, type AgentSurface } from './ai-tool-surface';

// The scope model shared by the user's standing prompt layer (#300) and the skill library (#301): which
// agent surfaces, and which languages within the editor surface, a piece of guidance applies to. Both
// features match the same two facts about a run — the surface it was dispatched from and the language
// of the document that owns it — so the matching lives once, here, where both compilation targets can
// reach it. Keep this module platform-neutral (types and pure functions only).

/**
 * Describes where a piece of guidance applies. An empty {@link surfaces} list means every surface; an
 * empty {@link languages} list means every language. Languages only ever match on the editor surface,
 * because that is the only surface with a document to have one — a scope naming a language and a
 * non-editor surface matches nothing there, which is the honest reading rather than a silent widening.
 */
export interface PromptScope {
  /**
   * Gets the surfaces the guidance applies to, or empty for all of them.
   */
  readonly surfaces: readonly AgentSurface[];

  /**
   * Gets the editor languages the guidance applies to, or empty for all of them.
   */
  readonly languages: readonly string[];
}

/**
 * What each surface is called where a user picks one. Named for what the user is looking at rather
 * than for the tool set — `editor` serves the markdown editor as well as the code editor.
 */
export const AGENT_SURFACE_LABELS: Readonly<Record<AgentSurface, string>> = {
  editor: 'Code & Markdown editors',
  terminal: 'Terminal',
  binary: 'Binary editor',
  api: 'API Explorer',
  workspace: 'Workspaces',
  project: 'Agent tab',
};

/**
 * The scope that applies everywhere.
 */
export const GLOBAL_SCOPE: PromptScope = { surfaces: [], languages: [] };

/**
 * Normalises a language identifier for comparison: lower-case and trimmed, so `CSharp` written into a
 * scope matches the `csharp` Monaco reports.
 * @param language The language identifier.
 * @returns Returns the normalised identifier.
 */
export function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase();
}

/**
 * Decides whether a scope applies to a run.
 * @param scope The scope to test.
 * @param surface The surface the run was dispatched from.
 * @param language The language of the document owning the run, or null when it has none.
 * @returns Returns true when the scope applies.
 */
export function scopeMatches(
  scope: PromptScope,
  surface: AgentSurface,
  language: string | null,
): boolean {
  if (scope.surfaces.length > 0 && !scope.surfaces.includes(surface)) {
    return false;
  }
  if (scope.languages.length === 0) {
    return true;
  }
  if (surface !== 'editor' || language === null) {
    return false;
  }
  const wanted: string = normalizeLanguage(language);
  return scope.languages.some(
    (candidate: string): boolean => normalizeLanguage(candidate) === wanted,
  );
}

/**
 * Ranks a scope by how specific it is, so several matching pieces of guidance compose from the general
 * to the particular: global first, then surface-scoped, then language-scoped. Language guidance stacks
 * on top of surface guidance rather than replacing it, which is the whole reason the rank exists — a
 * user who wrote "British English in markdown" and "be terse in the editor" wants both.
 * @param scope The scope to rank.
 * @returns Returns the rank, higher being more specific.
 */
export function scopeSpecificity(scope: PromptScope): number {
  return (scope.surfaces.length > 0 ? 1 : 0) + (scope.languages.length > 0 ? 2 : 0);
}

/**
 * Orders items by the specificity of their scope, keeping the caller's order among equals — so the
 * list the user arranged is the tie-break, not the id.
 * @param items The items to order.
 * @param scopeOf How to read an item's scope.
 * @returns Returns a new array, least specific first.
 */
export function sortByScope<T>(items: readonly T[], scopeOf: (item: T) => PromptScope): T[] {
  return items
    .map((item: T, index: number): { item: T; index: number; rank: number } => ({
      item,
      index,
      rank: scopeSpecificity(scopeOf(item)),
    }))
    .sort(
      (a: { rank: number; index: number }, b: { rank: number; index: number }): number =>
        a.rank - b.rank || a.index - b.index,
    )
    .map((entry: { item: T }): T => entry.item);
}

/**
 * Reads a scope out of untrusted data, dropping anything that is not a known surface or a non-empty
 * string. A scope that fails to parse is the global one rather than an error, because guidance whose
 * scope is unreadable is better applied everywhere than silently lost — the user can see it and narrow
 * it, where a dropped profile leaves nothing to see.
 * @param value The value to read.
 * @returns Returns the scope.
 */
export function readPromptScope(value: unknown): PromptScope {
  if (value === null || typeof value !== 'object') {
    return GLOBAL_SCOPE;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const surfaces: AgentSurface[] = Array.isArray(record['surfaces'])
    ? record['surfaces'].filter((entry: unknown): entry is AgentSurface =>
        AGENT_SURFACES.includes(entry as AgentSurface),
      )
    : [];
  const languages: string[] = Array.isArray(record['languages'])
    ? record['languages']
        .filter((entry: unknown): entry is string => typeof entry === 'string')
        .map(normalizeLanguage)
        .filter((entry: string): boolean => entry.length > 0)
    : [];
  return { surfaces: [...new Set(surfaces)], languages: [...new Set(languages)] };
}
