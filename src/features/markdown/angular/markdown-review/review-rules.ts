import type { ReviewIssue, ReviewKind } from './review-types';
import type { SpellChecker } from './review-spell';

/**
 * Zero (indices, lengths, comparisons).
 */
const ZERO: number = 0;

/**
 * One (single-character offsets and the "a" article length).
 */
const ONE: number = 1;

/**
 * Minimum word length considered for spell checking (skips a/an/etc.).
 */
const MIN_WORD_LEN: number = 3;

/**
 * Maximum characters of context shown either side of a flagged word.
 */
const CONTEXT_LEN: number = 28;

/**
 * Sentinel returned by {@link String.indexOf} when no match is found.
 */
const NOT_FOUND: number = -1;

/**
 * Matches a fenced code block.
 */
const FENCED_CODE: RegExp = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

/**
 * Matches inline code.
 */
const INLINE_CODE: RegExp = /`[^`]*`/g;

/**
 * Matches a URL or bare email.
 */
const URL_OR_EMAIL: RegExp = /\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/g;

/**
 * Matches a markdown link/image target — the `(...)` after `]`.
 */
const LINK_TARGET: RegExp = /(?<=\])\([^)]*\)/g;

/**
 * Matches an inline HTML tag.
 */
const HTML_TAG: RegExp = /<[^>]+>/g;

/**
 * Matches a word for spell checking (letters and apostrophes).
 */
const WORD: RegExp = /[A-Za-z][A-Za-z'’]*/g;

/**
 * Matches an all-uppercase acronym (skipped by the spell checker).
 */
const ACRONYM: RegExp = /^[A-Z]+$/;

/**
 * The flagged range and any suggestions a rule derives from a match.
 */
interface RuleMatch {
  /**
   * Gets the start offset of the flagged text.
   */
  readonly start: number;

  /**
   * Gets the end offset (exclusive) of the flagged text.
   */
  readonly end: number;

  /**
   * Gets the suggested replacements.
   */
  readonly suggestions: string[];
}

/**
 * A style/grammar rule that scans masked text for matches.
 */
interface RuleSpec {
  /**
   * Gets the issue category.
   */
  readonly kind: ReviewKind;

  /**
   * Gets the rule name shown on the card.
   */
  readonly name: string;

  /**
   * Gets a global regex matching offending text.
   */
  readonly regex: RegExp;

  /**
   * Builds the flagged range and any suggestions from a match.
   * @param match The regex match.
   * @returns Returns the range and suggestions.
   */
  readonly build: (match: RegExpExecArray) => RuleMatch;
}

/**
 * The curated style/grammar rules (documented, intentionally small).
 */
const RULES: readonly RuleSpec[] = [
  {
    kind: 'grammar',
    name: 'Repeated word',
    regex: /\b(\w+)\s+\1\b/gi,
    build: (match: RegExpExecArray): RuleMatch => ({
      start: match.index,
      end: match.index + match[0].length,
      suggestions: [match[1]],
    }),
  },
  {
    kind: 'grammar',
    name: 'Passive voice',
    regex: /\b(?:am|is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/gi,
    build: (match: RegExpExecArray): RuleMatch => ({
      start: match.index,
      end: match.index + match[0].length,
      suggestions: [],
    }),
  },
  {
    kind: 'grammar',
    name: 'Article agreement',
    regex: /\ba\s+[aeio]\w*/gi,
    build: (match: RegExpExecArray): RuleMatch => ({
      start: match.index,
      end: match.index + ONE,
      suggestions: ['an'],
    }),
  },
  {
    kind: 'style',
    name: 'Serial comma',
    regex: /\b(\w+),\s+(\w+)\s+(and|or)\s+(\w+)/g,
    build: (match: RegExpExecArray): RuleMatch => ({
      start: match.index,
      end: match.index + match[0].length,
      suggestions: [`${match[1]}, ${match[2]}, ${match[3]} ${match[4]}`],
    }),
  },
  {
    kind: 'style',
    name: 'Weak intensifier',
    regex: /\b(?:very|really)\b/gi,
    build: (match: RegExpExecArray): RuleMatch => ({
      start: match.index,
      end: match.index + match[0].length,
      suggestions: [],
    }),
  },
];

/**
 * Replaces a matched span with spaces of equal length, preserving offsets.
 * @param text The text to blank.
 * @param regex The regex to blank out.
 * @returns Returns the text with matches blanked.
 */
function blankOut(text: string, regex: RegExp): string {
  return text.replace(regex, (match: string): string => ' '.repeat(match.length));
}

/**
 * Blanks out code, URLs, links, and HTML from markdown so prose checks ignore them, while preserving
 * every character offset.
 * @param text The markdown source.
 * @returns Returns the masked text (same length as the input).
 */
export function maskText(text: string): string {
  let masked: string = blankOut(text, FENCED_CODE);
  masked = blankOut(masked, INLINE_CODE);
  masked = blankOut(masked, LINK_TARGET);
  masked = blankOut(masked, HTML_TAG);
  masked = blankOut(masked, URL_OR_EMAIL);
  return masked;
}

/**
 * Clips a context string to {@link CONTEXT_LEN}, adding an ellipsis on the clipped side.
 * @param value The raw context.
 * @param fromEnd Whether to keep the end (before-context) or the start (after-context).
 * @returns Returns the clipped context.
 */
function clip(value: string, fromEnd: boolean): string {
  if (value.length <= CONTEXT_LEN) {
    return value;
  }
  return fromEnd
    ? `…${value.slice(value.length - CONTEXT_LEN)}`
    : `${value.slice(ZERO, CONTEXT_LEN)}…`;
}

/**
 * Builds a {@link ReviewIssue} from a flagged range, deriving its context from the source line.
 * @param source The original source text.
 * @param start The start offset.
 * @param end The end offset.
 * @param kind The issue category.
 * @param ruleName The rule name.
 * @param suggestions The suggestions.
 * @returns Returns the issue.
 */
function makeIssue(
  source: string,
  start: number,
  end: number,
  kind: ReviewKind,
  ruleName: string,
  suggestions: readonly string[],
): ReviewIssue {
  const lineStart: number = source.lastIndexOf('\n', start - ONE) + ONE;
  const newlineAfter: number = source.indexOf('\n', end);
  const lineEnd: number = newlineAfter === NOT_FOUND ? source.length : newlineAfter;
  return {
    id: `${kind}:${start}:${end}`,
    kind,
    ruleName,
    word: source.slice(start, end),
    before: clip(source.slice(lineStart, start), true),
    after: clip(source.slice(end, lineEnd), false),
    start,
    end,
    suggestions,
  };
}

/**
 * Finds spelling issues by tokenising the masked text and checking each word.
 * @param source The original source.
 * @param masked The masked source (offsets aligned to source).
 * @param checker The spell checker.
 * @param userDictionary The user's added words (lowercased).
 * @returns Returns the spelling issues.
 */
function findSpellingIssues(
  source: string,
  masked: string,
  checker: SpellChecker,
  userDictionary: ReadonlySet<string>,
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let match: RegExpExecArray | null;
  WORD.lastIndex = ZERO;
  while ((match = WORD.exec(masked)) !== null) {
    const word: string = match[0];
    if (word.length < MIN_WORD_LEN || ACRONYM.test(word)) {
      continue;
    }
    const lower: string = word.toLowerCase();
    if (userDictionary.has(lower) || checker.isCorrect(word)) {
      continue;
    }
    const apostrophe: number = word.search(/['’]/);
    if (apostrophe > ZERO && checker.isCorrect(word.slice(ZERO, apostrophe))) {
      continue;
    }
    issues.push(
      makeIssue(
        source,
        match.index,
        match.index + word.length,
        'spelling',
        'Unknown word',
        checker.suggest(word),
      ),
    );
  }
  return issues;
}

/**
 * Finds style/grammar issues by running the curated rules over masked text.
 * @param source The original source.
 * @param masked The masked source.
 * @returns Returns the rule issues.
 */
function findRuleIssues(source: string, masked: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const rule of RULES) {
    rule.regex.lastIndex = ZERO;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(masked)) !== null) {
      const built: RuleMatch = rule.build(match);
      issues.push(
        makeIssue(source, built.start, built.end, rule.kind, rule.name, built.suggestions),
      );
    }
  }
  return issues;
}

/**
 * Analyses markdown text into review issues (spelling plus curated style/grammar), sorted by
 * position.
 * @param source The markdown source.
 * @param checker The spell checker.
 * @param userDictionary The user's added words (lowercased).
 * @returns Returns the issues in document order.
 */
export function analyzeMarkdown(
  source: string,
  checker: SpellChecker,
  userDictionary: ReadonlySet<string>,
): ReviewIssue[] {
  const masked: string = maskText(source);
  const issues: ReviewIssue[] = [
    ...findSpellingIssues(source, masked, checker, userDictionary),
    ...findRuleIssues(source, masked),
  ];
  return issues.sort((a: ReviewIssue, b: ReviewIssue): number => a.start - b.start);
}
