import type * as MonacoApi from 'monaco-editor';

/**
 * The brace-delimited languages the Visual-Studio-style folding provider is registered for. Each folds
 * its `{ … }` blocks from the block's signature line (see {@link braceRanges}), plus its `#region`
 * markers and multi-line comment runs. Languages that are not brace-delimited (for example Python) keep
 * Monaco's default indentation folding.
 */
const BRACE_FOLDING_LANGUAGES: readonly string[] = [
  'csharp',
  'cpp',
  'c',
  'java',
  'javascript',
  'typescript',
  'go',
  'rust',
  'kotlin',
];

/**
 * The line-count above which folding is skipped, so a very large file never pays the whole-document
 * tokenize-and-scan cost on every edit.
 */
const MAX_FOLDING_LINE_COUNT: number = 20000;

/**
 * Matches the token classifications a brace must NOT be inside to count as a real block delimiter: a
 * `{` or `}` within a string, comment, character/regex literal is punctuation, not a block boundary.
 */
const NON_CODE_TOKEN: RegExp = /string|comment|regex|char/;

/**
 * Matches a line that opens a foldable region, across the marker conventions the supported languages
 * use: C# `#region`, C/C++ `#pragma region`, and the `//#region` / `//region` / `// <editor-fold>`
 * line-comment forms (TypeScript, JavaScript, Java, Kotlin, Go, Rust).
 */
const REGION_START: RegExp =
  /^\s*(?:#\s*(?:pragma\s+)?region\b|\/\/\s*#?\s*region\b|\/\/\s*<editor-fold\b)/i;

/**
 * Matches a line that closes a foldable region, mirroring {@link REGION_START}.
 */
const REGION_END: RegExp =
  /^\s*(?:#\s*(?:pragma\s+)?endregion\b|\/\/\s*#?\s*endregion\b|\/\/\s*<\/editor-fold\b)/i;

/**
 * A located brace: its one-based line and column.
 */
interface BracePosition {
  readonly line: number;
  readonly column: number;
}

/**
 * Registers a Visual-Studio-style folding provider for the brace-delimited languages. It folds each
 * `{ … }` block from the block's signature line — so an Allman-brace class or method (the brace alone on
 * the next line) shows its fold control on the declaration rather than the brace, matching Visual
 * Studio — and additionally folds `#region` markers and multi-line comment runs. It replaces Monaco's
 * default indentation folding for these languages (Monaco uses registered providers in preference to
 * indentation folding), so those region and comment folds are re-provided here rather than lost.
 * @param monaco The loaded Monaco namespace, or undefined before it has loaded (a no-op).
 */
export function registerBraceFolding(monaco: typeof MonacoApi | undefined): void {
  if (monaco === undefined) {
    return;
  }
  const provider: MonacoApi.languages.FoldingRangeProvider = {
    provideFoldingRanges: (
      model: MonacoApi.editor.ITextModel,
    ): MonacoApi.languages.FoldingRange[] => computeFoldingRanges(monaco, model),
  };
  for (const language of BRACE_FOLDING_LANGUAGES) {
    monaco.languages.registerFoldingRangeProvider(language, provider);
  }
}

/**
 * Computes all folding ranges for a brace-delimited model: brace blocks (folded from their signature
 * line), `#region` markers, and multi-line comment runs. The model is tokenized once and shared by the
 * brace and comment passes, so braces inside strings/comments and comment lines are classified
 * consistently.
 * @param monaco The loaded Monaco namespace.
 * @param model The model to fold.
 * @returns Returns the folding ranges, or an empty list for a file past the size guard.
 */
export function computeFoldingRanges(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
): MonacoApi.languages.FoldingRange[] {
  if (model.getLineCount() > MAX_FOLDING_LINE_COUNT) {
    return [];
  }
  const tokens: MonacoApi.Token[][] = monaco.editor.tokenize(
    model.getValue(),
    model.getLanguageId(),
  );
  return [
    ...braceRanges(model, tokens),
    ...regionRanges(monaco, model),
    ...commentRanges(monaco, model, tokens),
  ];
}

/**
 * Pairs the model's real `{ … }` braces (skipping those inside strings and comments) into folding
 * ranges, each folded from the block's signature line.
 * @param model The model being folded.
 * @param tokens The model's tokens, one array per line.
 * @returns Returns the brace folding ranges.
 */
function braceRanges(
  model: MonacoApi.editor.ITextModel,
  tokens: MonacoApi.Token[][],
): MonacoApi.languages.FoldingRange[] {
  const lineCount: number = model.getLineCount();
  const open: BracePosition[] = [];
  const ranges: MonacoApi.languages.FoldingRange[] = [];
  for (let line: number = 1; line <= lineCount; line += 1) {
    const text: string = model.getLineContent(line);
    const lineTokens: MonacoApi.Token[] = tokens[line - 1] ?? [];
    for (let index: number = 0; index < text.length; index += 1) {
      const character: string = text[index];
      if (character !== '{' && character !== '}') {
        continue;
      }
      if (NON_CODE_TOKEN.test(tokenTypeAt(lineTokens, index))) {
        continue;
      }
      if (character === '{') {
        open.push({ line, column: index + 1 });
      } else {
        const opening: BracePosition | undefined = open.pop();
        const range: MonacoApi.languages.FoldingRange | null =
          opening === undefined ? null : toBraceRange(model, opening, line);
        if (range !== null) {
          ranges.push(range);
        }
      }
    }
  }
  return ranges;
}

/**
 * Builds the folding range for one brace block, folding from the block's signature line: when the
 * opening brace is the first non-whitespace character on its line (Allman style), the range starts on
 * the nearest non-blank line above it (the signature); otherwise (the brace trails the signature, K&R
 * style) it starts on the brace's own line. A block that would not span more than one visible line is
 * dropped.
 * @param model The model being folded.
 * @param opening The opening brace's position.
 * @param closingLine The one-based line of the matching closing brace.
 * @returns Returns the folding range, or null when there is nothing to fold.
 */
function toBraceRange(
  model: MonacoApi.editor.ITextModel,
  opening: BracePosition,
  closingLine: number,
): MonacoApi.languages.FoldingRange | null {
  const braceIsFirstOnLine: boolean =
    model.getLineFirstNonWhitespaceColumn(opening.line) === opening.column;
  let start: number = opening.line;
  if (braceIsFirstOnLine) {
    let above: number = opening.line - 1;
    while (above >= 1 && model.getLineFirstNonWhitespaceColumn(above) === 0) {
      above -= 1;
    }
    if (above >= 1) {
      start = above;
    }
  }
  if (closingLine <= start) {
    return null;
  }
  return { start, end: closingLine };
}

/**
 * Pairs `#region` / `#endregion` markers (and their line-comment equivalents) into folding ranges,
 * nesting via a stack so inner regions fold independently.
 * @param monaco The loaded Monaco namespace (for the region fold kind).
 * @param model The model being folded.
 * @returns Returns the region folding ranges.
 */
function regionRanges(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
): MonacoApi.languages.FoldingRange[] {
  const lineCount: number = model.getLineCount();
  const open: number[] = [];
  const ranges: MonacoApi.languages.FoldingRange[] = [];
  for (let line: number = 1; line <= lineCount; line += 1) {
    const text: string = model.getLineContent(line);
    if (REGION_START.test(text)) {
      open.push(line);
    } else if (REGION_END.test(text)) {
      const start: number | undefined = open.pop();
      if (start !== undefined && line > start) {
        ranges.push({ start, end: line, kind: monaco.languages.FoldingRangeKind.Region });
      }
    }
  }
  return ranges;
}

/**
 * Folds runs of two or more consecutive comment lines (line comments such as `//`/`///`, and the lines
 * of a multi-line `/* … *\/` block, which tokenize as comments). Region-marker lines are excluded — they
 * are their own fold — so a `//region` never joins a comment run.
 * @param monaco The loaded Monaco namespace (for the comment fold kind).
 * @param model The model being folded.
 * @param tokens The model's tokens, one array per line.
 * @returns Returns the comment folding ranges.
 */
function commentRanges(
  monaco: typeof MonacoApi,
  model: MonacoApi.editor.ITextModel,
  tokens: MonacoApi.Token[][],
): MonacoApi.languages.FoldingRange[] {
  const lineCount: number = model.getLineCount();
  const ranges: MonacoApi.languages.FoldingRange[] = [];
  let runStart: number = 0;
  for (let line: number = 1; line <= lineCount + 1; line += 1) {
    const isComment: boolean =
      line <= lineCount &&
      isCommentLine(model, tokens[line - 1] ?? [], line) &&
      !REGION_START.test(model.getLineContent(line)) &&
      !REGION_END.test(model.getLineContent(line));
    if (isComment) {
      if (runStart === 0) {
        runStart = line;
      }
    } else {
      if (runStart !== 0 && line - 1 > runStart) {
        ranges.push({
          start: runStart,
          end: line - 1,
          kind: monaco.languages.FoldingRangeKind.Comment,
        });
      }
      runStart = 0;
    }
  }
  return ranges;
}

/**
 * Determines whether a line's first non-whitespace character sits inside a comment token, so the line
 * counts as comment content for the comment-run fold.
 * @param model The model being folded.
 * @param lineTokens The line's tokens.
 * @param line The one-based line number.
 * @returns Returns true when the line leads with comment content.
 */
function isCommentLine(
  model: MonacoApi.editor.ITextModel,
  lineTokens: MonacoApi.Token[],
  line: number,
): boolean {
  const firstColumn: number = model.getLineFirstNonWhitespaceColumn(line);
  if (firstColumn === 0) {
    return false;
  }
  return tokenTypeAt(lineTokens, firstColumn - 1).includes('comment');
}

/**
 * Resolves the token classification covering a character column on a tokenized line: the type of the
 * last token starting at or before the column.
 * @param tokens The line's tokens, ordered by start offset.
 * @param column The zero-based character offset on the line.
 * @returns Returns the token type, or the empty string when the line has no tokens.
 */
function tokenTypeAt(tokens: MonacoApi.Token[], column: number): string {
  let type: string = '';
  for (const token of tokens) {
    if (token.offset > column) {
      break;
    }
    type = token.type;
  }
  return type;
}
