/**
 * The languages whose Monaco-bundled Monarch tokenizer colours keywords, strings and comments but
 * leaves type and method identifiers in the default foreground. TypeScript and JavaScript are
 * excluded because their language service already supplies semantic tokens.
 */
export const HEURISTIC_SEMANTIC_TOKEN_LANGUAGES: readonly string[] = [
  'csharp',
  'java',
  'kotlin',
  'rust',
  'go',
  'cpp',
  'c',
];

/**
 * The semantic-token legend for the heuristic provider: index 0 is `type`, index 1 is `function`.
 * The registered themes colour both (see the theme definitions in `monaco-themes`).
 */
export const HEURISTIC_SEMANTIC_TOKEN_LEGEND: { tokenTypes: string[]; tokenModifiers: string[] } = {
  tokenTypes: ['type', 'function'],
  tokenModifiers: [],
};

// Index into the legend's tokenTypes for the "type" classification.
const HEURISTIC_TYPE_INDEX: number = 0;
// Index into the legend's tokenTypes for the "function" classification.
const HEURISTIC_FUNCTION_INDEX: number = 1;
// Sentinel value indicating an identifier was not classified.
const HEURISTIC_NO_TOKEN_INDEX: number = -1;
// Minimum identifier length required before treating a PascalCase identifier as a type.
const HEURISTIC_MIN_TYPE_NAME_LENGTH: number = 1;
// Bitset of token modifiers applied to each emitted token (none).
const HEURISTIC_NO_MODIFIERS: number = 0;
// Delta-line value identifying a token on the same line as the previous one.
const HEURISTIC_SAME_LINE_DELTA: number = 0;
// Step used to adjust binary-search bounds by a single index.
const HEURISTIC_SEARCH_STEP: number = 1;
// Right shift amount that halves a value (integer divide by two).
const HEURISTIC_HALVE_SHIFT: number = 1;

/**
 * A minimal view of a Monaco Monarch token: the column it starts at and its scope name. Matches the
 * shape of `MonacoApi.Token` (`monaco.editor.tokenize` output) without depending on the loaded
 * editor, so the scan can be unit tested.
 */
export interface MonarchToken {
  /**
   * Gets the zero-based column the token starts at.
   */
  readonly offset: number;

  /**
   * Gets the token's scope name (for example `keyword.cs` or `identifier`).
   */
  readonly type: string;
}

/**
 * Builds delta-packed semantic tokens that colour type and method identifiers a Monarch tokenizer
 * leaves uncoloured. Emits a `type` token for a PascalCase identifier and a `function` token for an
 * identifier immediately followed by `(`, skipping any identifier the Monarch pass already classified
 * as a string, comment or keyword so it never repaints over them.
 *
 * This is heuristic, not semantic: PascalCase constants colour as types, method definitions colour
 * the same as calls, and similar minor mislabels are inherent. A language server supersedes it.
 * @param source The full document text.
 * @param monarchLines The Monarch tokens per line (from `monaco.editor.tokenize`), used only to skip
 * strings, comments and keywords.
 * @returns Returns the delta-packed token data for a Monaco `SemanticTokens` result.
 */
export function buildHeuristicSemanticTokens(
  source: string,
  monarchLines: readonly (readonly MonarchToken[])[],
): Uint32Array {
  const lines: readonly string[] = source.split(/\r\n|\r|\n/);
  const identifierPattern: RegExp = /\b([A-Za-z_]\w*)(\s*[<(])?/g;
  const isSkippableTokenType: (type: string) => boolean = (type: string): boolean =>
    type.startsWith('string') || type.startsWith('comment') || type.startsWith('keyword');
  const data: number[] = [];
  let prevLine: number = 0;
  let prevChar: number = 0;

  for (let lineIdx: number = 0; lineIdx < lines.length; lineIdx++) {
    const line: string = lines[lineIdx];
    const lineTokens: readonly MonarchToken[] = monarchLines[lineIdx] ?? [];

    // Binary search the Monarch token covering a column, so identifiers inside strings or comments
    // can be skipped.
    const tokenTypeAt: (col: number) => string = (col: number): string => {
      let lo: number = 0;
      let hi: number = lineTokens.length - HEURISTIC_SEARCH_STEP;
      let best: number = 0;
      while (lo <= hi) {
        const mid: number = (lo + hi) >> HEURISTIC_HALVE_SHIFT;
        if (lineTokens[mid].offset <= col) {
          best = mid;
          lo = mid + HEURISTIC_SEARCH_STEP;
        } else {
          hi = mid - HEURISTIC_SEARCH_STEP;
        }
      }
      return lineTokens[best]?.type ?? '';
    };

    identifierPattern.lastIndex = 0;
    let match: RegExpExecArray | null = identifierPattern.exec(line);
    while (match !== null) {
      const name: string = match[1];
      const trailer: string = (match[2] ?? '').trim();
      const startChar: number = match.index;

      if (!isSkippableTokenType(tokenTypeAt(startChar))) {
        let tokenTypeIdx: number = HEURISTIC_NO_TOKEN_INDEX;
        if (trailer === '(') {
          tokenTypeIdx = HEURISTIC_FUNCTION_INDEX;
        } else if (/^[A-Z]/.test(name) && name.length > HEURISTIC_MIN_TYPE_NAME_LENGTH) {
          tokenTypeIdx = HEURISTIC_TYPE_INDEX;
        }
        if (tokenTypeIdx !== HEURISTIC_NO_TOKEN_INDEX) {
          const deltaLine: number = lineIdx - prevLine;
          const deltaChar: number =
            deltaLine === HEURISTIC_SAME_LINE_DELTA ? startChar - prevChar : startChar;
          data.push(deltaLine, deltaChar, name.length, tokenTypeIdx, HEURISTIC_NO_MODIFIERS);
          prevLine = lineIdx;
          prevChar = startChar;
        }
      }
      match = identifierPattern.exec(line);
    }
  }

  return new Uint32Array(data);
}
