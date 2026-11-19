import { scopeMatches, type AgentSurface } from './ai-types';
import { normalizeTag, type PersonaEntry } from './persona-channels';

// Finding the memories that bear on a conversation (#1515). The agent chooses when to search and with
// what, as it chooses when to load a skill; this ranks the persona's memories against its words and
// tags. Plain word and tag matching for now (§6.6 of #1513): search by meaning needs a way to compare
// meaning, which is a later step. Keep this module platform-neutral (types and pure functions only).

/**
 * What the agent searches with.
 */
export interface PersonaSearchRequest {
  /**
   * Gets the words to look for, as the agent wrote them.
   */
  readonly words: string;

  /**
   * Gets the tags to look for.
   */
  readonly tags: readonly string[];

  /**
   * Gets the most memories to return.
   */
  readonly limit: number;
}

/**
 * One memory a search found.
 */
export interface PersonaSearchHit {
  /**
   * Gets the memory.
   */
  readonly entry: PersonaEntry;

  /**
   * Gets whether it was found by the words or tags searched for, rather than added because it is a
   * general preference that may apply anyway.
   */
  readonly matched: boolean;
}

/**
 * The tag a general preference carries: how the user likes to communicate, decide and work, which
 * applies whatever the topic.
 */
export const GENERAL_PREFERENCE_TAG: string = 'preferences';

/**
 * The most memories one search returns, whatever the agent asked for.
 */
export const PERSONA_SEARCH_LIMIT: number = 12;

/**
 * Words too common to say anything about what a memory is about.
 */
const STOP_WORDS: ReadonlySet<string> = new Set<string>([
  'the',
  'and',
  'for',
  'with',
  'about',
  'what',
  'which',
  'how',
  'does',
  'user',
  'users',
  'they',
  'their',
  'this',
  'that',
  'like',
  'likes',
  'prefer',
  'prefers',
  'when',
  'from',
  'into',
  'any',
]);

/**
 * Lists the memories an agent on a surface may be given: enabled, and scoped to where it runs.
 * @param entries The persona's entries.
 * @param surface The run's surface.
 * @param language The run's language, or null.
 * @returns Returns the memories.
 */
export function memoriesInScope(
  entries: readonly PersonaEntry[],
  surface: AgentSurface,
  language: string | null,
): readonly PersonaEntry[] {
  return entries.filter(
    (entry: PersonaEntry): boolean =>
      entry.layer === 'memory' && entry.enabled && scopeMatches(entry.scope, surface, language),
  );
}

/**
 * Splits search words into the terms matched: lower-case, at least three letters, common words
 * dropped, a plural's `s` dropped so "recommendations" finds "recommendation".
 * @param words The words.
 * @returns Returns the terms, without repeats.
 */
export function searchTerms(words: string): readonly string[] {
  const terms: Set<string> = new Set<string>();
  for (const raw of words.toLowerCase().split(/[^\p{L}\p{N}#+]+/u)) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) {
      continue;
    }
    terms.add(raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw);
  }
  return [...terms];
}

/**
 * Ranks the memories against a search. A tag asked for counts most, then a term in a memory's tags,
 * then in its name, then in its text or reason. When fewer than the limit match, general preferences
 * fill the rest: a preference about how the user makes decisions bears on a question about laptops
 * that never mentions one, and the agent cannot be expected to guess every word Pete filed it under.
 * @param memories The memories in scope.
 * @param request The search.
 * @returns Returns the hits, best first.
 */
export function searchPersona(
  memories: readonly PersonaEntry[],
  request: PersonaSearchRequest,
): readonly PersonaSearchHit[] {
  const limit: number = Math.min(Math.max(Math.floor(request.limit), 1), PERSONA_SEARCH_LIMIT);
  const tags: readonly string[] = request.tags
    .map(normalizeTag)
    .filter((tag: string): boolean => tag.length > 0);
  const terms: readonly string[] = searchTerms(request.words);
  const scored: { readonly entry: PersonaEntry; readonly score: number }[] = [];
  for (const entry of memories) {
    const score: number = scoreOf(entry, tags, terms);
    if (score > 0) {
      scored.push({ entry, score });
    }
  }
  scored.sort(
    (a, b): number =>
      b.score - a.score ||
      b.entry.confidence - a.entry.confidence ||
      a.entry.id.localeCompare(b.entry.id),
  );
  const hits: PersonaSearchHit[] = scored
    .slice(0, limit)
    .map(({ entry }): PersonaSearchHit => ({ entry, matched: true }));
  const found: Set<string> = new Set<string>(
    hits.map((hit: PersonaSearchHit): string => hit.entry.id),
  );
  const general: readonly PersonaEntry[] = memories
    .filter(
      (entry: PersonaEntry): boolean =>
        !found.has(entry.id) && entry.tags.includes(GENERAL_PREFERENCE_TAG),
    )
    .sort(
      (a: PersonaEntry, b: PersonaEntry): number =>
        b.confidence - a.confidence || a.id.localeCompare(b.id),
    );
  for (const entry of general) {
    if (hits.length >= limit) {
      break;
    }
    hits.push({ entry, matched: false });
  }
  return hits;
}

/**
 * Scores one memory against a search.
 * @param entry The memory.
 * @param tags The tags asked for.
 * @param terms The search terms.
 * @returns Returns the score; 0 for no match.
 */
function scoreOf(entry: PersonaEntry, tags: readonly string[], terms: readonly string[]): number {
  let score: number = 0;
  for (const tag of tags) {
    if (entry.tags.includes(tag)) {
      score += 5;
    }
  }
  const name: string = entry.name.toLowerCase();
  const body: string = `${entry.text}\n${entry.why}`.toLowerCase();
  for (const term of terms) {
    if (entry.tags.some((tag: string): boolean => tag.includes(term))) {
      score += 3;
    }
    if (name.includes(term)) {
      score += 2;
    }
    if (body.includes(term)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Renders hits for the agent: each memory's text, reason and tags, under its id so the agent can
 * name one to forget. Plain text, because the agent reads it as it would read a note.
 * @param hits The hits.
 * @returns Returns the text.
 */
export function renderPersonaHits(hits: readonly PersonaSearchHit[]): string {
  if (hits.length === 0) {
    return 'Nothing in the persona matches. Try other words, or a broader tag such as "preferences".';
  }
  const found: readonly PersonaSearchHit[] = hits.filter(
    (hit: PersonaSearchHit): boolean => hit.matched,
  );
  const general: readonly PersonaSearchHit[] = hits.filter(
    (hit: PersonaSearchHit): boolean => !hit.matched,
  );
  const sections: string[] = [];
  if (found.length > 0) {
    sections.push(['Found in the persona:', ...found.map(renderHit)].join('\n\n'));
  }
  if (general.length > 0) {
    sections.push(
      ['General preferences, which may apply here too:', ...general.map(renderHit)].join('\n\n'),
    );
  }
  return sections.join('\n\n');
}

/**
 * Renders one hit.
 * @param hit The hit.
 * @returns Returns its text.
 */
function renderHit(hit: PersonaSearchHit): string {
  const entry: PersonaEntry = hit.entry;
  const lines: string[] = [
    `- ${entry.name} (id: ${entry.id})`,
    `  ${entry.text.trim().replace(/\n/g, '\n  ')}`,
  ];
  if (entry.why.trim().length > 0) {
    lines.push(`  Why: ${entry.why.trim()}`);
  }
  if (entry.tags.length > 0) {
    lines.push(`  Tags: ${entry.tags.join(', ')}`);
  }
  if (entry.author === 'pete' && entry.confidence < 0.6) {
    lines.push('  (Learned, and not yet certain: treat it as a guess.)');
  }
  return lines.join('\n');
}
