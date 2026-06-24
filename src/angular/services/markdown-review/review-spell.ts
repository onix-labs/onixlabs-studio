/**
 * Zero (indices, counts, comparisons).
 */
const ZERO: number = 0;

/**
 * One (increments and single-character offsets).
 */
const ONE: number = 1;

/**
 * Maximum edit distance for a spelling suggestion.
 */
const MAX_EDIT: number = 2;

/**
 * Maximum number of suggestions returned per misspelling.
 */
const SUGGESTION_COUNT: number = 3;

/**
 * Loads the spelling dictionary's words.
 */
export type DictionaryLoader = () => Promise<readonly string[]>;

/**
 * Lazily loads the bundled English word list. The ~3 MB list is dynamically imported, so it is split
 * into its own chunk and only fetched the first time the Review tool runs.
 * @returns Returns the dictionary words.
 */
export async function loadEnglishWords(): Promise<readonly string[]> {
  return (await import('an-array-of-english-words')).default;
}

/**
 * Computes the Levenshtein edit distance between two strings, stopping early once it is known to
 * exceed {@link max} (returning `max + 1`).
 * @param a The first string.
 * @param b The second string.
 * @param max The distance ceiling.
 * @returns Returns the edit distance, or `max + 1` when it exceeds the ceiling.
 */
function boundedLevenshtein(a: string, b: string, max: number): number {
  const lengthA: number = a.length;
  const lengthB: number = b.length;
  if (Math.abs(lengthA - lengthB) > max) {
    return max + ONE;
  }

  let previous: number[] = Array.from(
    { length: lengthB + ONE },
    (unused: unknown, index: number): number => index,
  );
  let current: number[] = new Array<number>(lengthB + ONE).fill(ZERO);

  for (let i: number = ONE; i <= lengthA; i++) {
    current[ZERO] = i;
    let rowMin: number = current[ZERO];
    for (let j: number = ONE; j <= lengthB; j++) {
      const cost: number = a[i - ONE] === b[j - ONE] ? ZERO : ONE;
      current[j] = Math.min(previous[j] + ONE, current[j - ONE] + ONE, previous[j - ONE] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) {
      return max + ONE;
    }
    [previous, current] = [current, previous];
  }
  return previous[lengthB];
}

/**
 * A dictionary-backed spell checker: case-insensitive membership plus bounded edit-distance
 * suggestions. Words are bucketed by first letter so suggestion lookups scan only a slice of the
 * dictionary.
 */
export class SpellChecker {
  /**
   * Holds the lowercased dictionary words.
   */
  private readonly words: ReadonlySet<string>;

  /**
   * Holds the words bucketed by their first letter, for fast suggestion candidates.
   */
  private readonly byFirstLetter: ReadonlyMap<string, string[]>;

  /**
   * Builds a checker from a word list.
   * @param wordList The dictionary words (any case).
   */
  public constructor(wordList: Iterable<string>) {
    const words: Set<string> = new Set<string>();
    const buckets: Map<string, string[]> = new Map<string, string[]>();
    for (const raw of wordList) {
      const word: string = raw.toLowerCase();
      if (word.length === ZERO) {
        continue;
      }
      words.add(word);
      const first: string = word[ZERO];
      const bucket: string[] | undefined = buckets.get(first);
      if (bucket !== undefined) {
        bucket.push(word);
      } else {
        buckets.set(first, [word]);
      }
    }
    this.words = words;
    this.byFirstLetter = buckets;
  }

  /**
   * Determines whether a word is spelled correctly (case-insensitive).
   * @param word The word to check.
   * @returns Returns true when the word is in the dictionary.
   */
  public isCorrect(word: string): boolean {
    return this.words.has(word.toLowerCase());
  }

  /**
   * Suggests corrections for a misspelled word, ranked by edit distance then alphabetically,
   * preserving the word's leading capitalisation.
   * @param word The misspelled word.
   * @returns Returns up to three suggestions.
   */
  public suggest(word: string): string[] {
    const lower: string = word.toLowerCase();
    const candidates: string[] = this.byFirstLetter.get(lower[ZERO]) ?? [];
    const scored: { word: string; distance: number }[] = [];
    for (const candidate of candidates) {
      if (Math.abs(candidate.length - lower.length) > MAX_EDIT) {
        continue;
      }
      if (candidate === lower) {
        continue;
      }
      const distance: number = boundedLevenshtein(lower, candidate, MAX_EDIT);
      if (distance <= MAX_EDIT) {
        scored.push({ word: candidate, distance });
      }
    }
    scored.sort(
      (a: { word: string; distance: number }, b: { word: string; distance: number }): number =>
        a.distance - b.distance || a.word.localeCompare(b.word),
    );
    const capitalize: boolean = /^[A-Z]/.test(word);
    return scored
      .slice(ZERO, SUGGESTION_COUNT)
      .map((entry: { word: string; distance: number }): string =>
        capitalize ? entry.word[ZERO].toUpperCase() + entry.word.slice(ONE) : entry.word,
      );
  }
}
