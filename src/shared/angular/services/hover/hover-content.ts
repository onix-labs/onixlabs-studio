import type * as MonacoApi from 'monaco-editor';
import type { ProvidedHover } from '@shared/angular/services/monaco/monaco-editor-capabilities';

/**
 * Holds Monaco's `MarkerSeverity` values, written as values for an editor whose window has no Monaco
 * to read them from.
 */
export const MARKER_SEVERITY: Readonly<Record<'hint' | 'info' | 'warning' | 'error', number>> = {
  hint: 1,
  info: 2,
  warning: 4,
  error: 8,
};

/**
 * One problem on the spot a hover card is about (#1020).
 */
export interface HoverProblem {
  /**
   * Gets what the problem says.
   */
  readonly message: string;

  /**
   * Gets its severity, as Monaco's `MarkerSeverity` numbers it.
   */
  readonly severity: number;

  /**
   * Gets what reported it (the language server's name, say), or null when nothing says.
   */
  readonly source: string | null;

  /**
   * Gets its code, or null when it has none.
   */
  readonly code: string | null;

  /**
   * Gets where it is, one-based.
   */
  readonly range: MonacoApi.IRange;
}

/**
 * What a hover card offers to do with the symbol it is about.
 */
export interface HoverCardActions {
  /**
   * Gets whether Go to Definition shows: the language can answer it.
   */
  readonly definition: boolean;

  /**
   * Gets whether Find All References shows: the language can answer it.
   */
  readonly references: boolean;

  /**
   * Gets whether a References panel would list the answer; Find All References is inert otherwise.
   */
  readonly referencesListed: boolean;
}

/**
 * Everything a hover card shows (#1020).
 */
export interface HoverCardContent {
  /**
   * Gets the type and documentation of the symbol — or a gutter decoration's description — as
   * markdown sections, in the order they show, each separated from the next.
   */
  readonly sections: readonly string[];

  /**
   * Gets the problems on the spot, the most severe first.
   */
  readonly problems: readonly HoverProblem[];

  /**
   * Gets whether each problem offers Quick Fix…: the editor can be edited and offers fixes.
   */
  readonly quickFix: boolean;

  /**
   * Gets what the card offers to do with the symbol, or null when it is about no symbol (a gutter
   * decoration, a problem off any word).
   */
  readonly actions: HoverCardActions | null;
}

/**
 * Determines whether a hover card has anything to show; a card with only its actions row would be a
 * row of buttons over every word.
 * @param content The card's content.
 * @returns Returns true when it has sections or problems.
 */
export function hasContent(content: HoverCardContent): boolean {
  return content.sections.length > 0 || content.problems.length > 0;
}

/**
 * Builds a hover card's sections from what the hover providers said and what the decorations on the
 * spot say (a decoration's own hover message), as Monaco merges them: every provider's blocks in rank
 * order, then the decorations'. A block saying exactly what an earlier one said — two providers for one
 * language often agree — is shown once.
 * @param hovers The providers' answers, in rank order.
 * @param messages The decorations' hover messages.
 * @returns Returns the sections, as markdown.
 */
export function hoverSections(
  hovers: readonly ProvidedHover[],
  messages: readonly MonacoApi.IMarkdownString[] = [],
): string[] {
  const sections: string[] = [];
  const seen: Set<string> = new Set<string>();
  const blocks: readonly MonacoApi.IMarkdownString[] = [
    ...hovers.flatMap(
      (hover: ProvidedHover): readonly MonacoApi.IMarkdownString[] => hover.contents,
    ),
    ...messages,
  ];
  for (const block of blocks) {
    const markdown: string = prepareMarkdown(block).trim();
    if (markdown.length === 0 || seen.has(markdown)) {
      continue;
    }
    seen.add(markdown);
    sections.push(markdown);
  }
  return sections;
}

/**
 * Prepares one of Monaco's markdown strings for Studio's markdown renderer: raw HTML in it is shown as
 * text, as Monaco shows it, unless the string says it may carry HTML.
 * @param block The markdown string.
 * @returns Returns the markdown.
 */
export function prepareMarkdown(block: MonacoApi.IMarkdownString): string {
  return block.supportHtml === true ? block.value : escapeRawHtml(block.value);
}

/**
 * Escapes the raw HTML in markdown so it shows as the text it is — `List<string>` in a sentence keeps
 * its `<string>` — leaving code alone: fenced blocks and inline code spans show their text as written
 * already. An autolink (`<https://…>`) stays a link.
 * @param markdown The markdown.
 * @returns Returns the markdown with its raw HTML escaped.
 */
export function escapeRawHtml(markdown: string): string {
  const lines: readonly string[] = markdown.split('\n');
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush: () => void = (): void => {
    if (prose.length > 0) {
      out.push(escapeOutsideCodeSpans(prose.join('\n')));
      prose = [];
    }
  };
  for (const line of lines) {
    const opener: RegExpExecArray | null = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null && opener !== null) {
      flush();
      fence = opener[1];
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      const closer: RegExpExecArray | null = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closer !== null && closer[1].startsWith(fence[0]) && closer[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    prose.push(line);
  }
  flush();
  return out.join('\n');
}

/**
 * Escapes the raw HTML in a run of prose, leaving its inline code spans as they are.
 * @param prose The prose.
 * @returns Returns the prose with `<` outside code spans escaped.
 */
function escapeOutsideCodeSpans(prose: string): string {
  let result: string = '';
  let index: number = 0;
  while (index < prose.length) {
    const tick: number = prose.indexOf('`', index);
    if (tick < 0) {
      result += escapeAngles(prose.slice(index));
      break;
    }
    result += escapeAngles(prose.slice(index, tick));
    let run: number = tick;
    while (prose[run] === '`') {
      run += 1;
    }
    const opener: string = prose.slice(tick, run);
    const close: number = closingRun(prose, run, opener.length);
    if (close < 0) {
      // An unmatched run of backticks is text, not a code span.
      result += opener;
      index = run;
      continue;
    }
    result += prose.slice(tick, close + opener.length);
    index = close + opener.length;
  }
  return result;
}

/**
 * Finds the run of exactly a number of backticks that closes a code span.
 * @param text The text.
 * @param from Where to look from.
 * @param length The opening run's length.
 * @returns Returns where the closing run starts, or -1 when the span is never closed.
 */
function closingRun(text: string, from: number, length: number): number {
  let index: number = from;
  while (index < text.length) {
    const tick: number = text.indexOf('`', index);
    if (tick < 0) {
      return -1;
    }
    let run: number = tick;
    while (text[run] === '`') {
      run += 1;
    }
    if (run - tick === length) {
      return tick;
    }
    index = run;
  }
  return -1;
}

/**
 * Escapes every `<` that does not open an autolink.
 * @param text The text.
 * @returns Returns the text with its tags shown as text.
 */
function escapeAngles(text: string): string {
  return text.replace(/<(?!(?:https?|mailto):[^\s<>]*>)/g, '&lt;');
}

/**
 * Lists the problems a position is on — each problem whose span holds it, its ends included — the
 * most severe first, as a hover card lists them.
 * @param markers The problems of the model.
 * @param position The one-based position.
 * @returns Returns the problems.
 */
export function problemsAt(
  markers: readonly MonacoApi.editor.IMarker[],
  position: MonacoApi.IPosition,
): HoverProblem[] {
  return markers
    .filter((marker: MonacoApi.editor.IMarker): boolean => rangeHolds(marker, position))
    .sort(
      (left: MonacoApi.editor.IMarker, right: MonacoApi.editor.IMarker): number =>
        right.severity - left.severity,
    )
    .map((marker: MonacoApi.editor.IMarker): HoverProblem => ({
      message: marker.message,
      severity: marker.severity,
      source: marker.source !== undefined && marker.source.length > 0 ? marker.source : null,
      code: codeOf(marker.code),
      range: {
        startLineNumber: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLineNumber: marker.endLineNumber,
        endColumn: marker.endColumn,
      },
    }));
}

/**
 * Says where a problem came from and its code — `ts(2304)`, `CS0103` — or nothing when neither is
 * known, as Monaco's own hover put it after the message.
 * @param problem The problem.
 * @returns Returns the detail, or null.
 */
export function problemDetail(problem: HoverProblem): string | null {
  if (problem.source !== null && problem.code !== null) {
    return `${problem.source}(${problem.code})`;
  }
  return problem.source ?? problem.code;
}

/**
 * Finds the problem to go to from a caret (#1020): the next one starting after it, or the previous one
 * starting before it, wrapping round the document's ends. Hints are passed over, as Monaco's own
 * problem navigation passes them.
 * @param markers The problems of the model.
 * @param caret The one-based caret.
 * @param direction Which way to go.
 * @returns Returns the problem's span, or null when the document has no problems.
 */
export function problemFrom(
  markers: readonly MonacoApi.editor.IMarker[],
  caret: MonacoApi.IPosition,
  direction: 'next' | 'previous',
): MonacoApi.IRange | null {
  const ordered: readonly MonacoApi.editor.IMarker[] = markers
    .filter(
      // Read as a number: the severities are written as values, for a window with no Monaco.
      (marker: MonacoApi.editor.IMarker): boolean => Number(marker.severity) > MARKER_SEVERITY.hint,
    )
    .sort(
      (left: MonacoApi.editor.IMarker, right: MonacoApi.editor.IMarker): number =>
        left.startLineNumber - right.startLineNumber || left.startColumn - right.startColumn,
    );
  if (ordered.length === 0) {
    return null;
  }
  const after: (marker: MonacoApi.editor.IMarker) => number = (
    marker: MonacoApi.editor.IMarker,
  ): number => marker.startLineNumber - caret.lineNumber || marker.startColumn - caret.column;
  const found: MonacoApi.editor.IMarker =
    direction === 'next'
      ? (ordered.find((marker: MonacoApi.editor.IMarker): boolean => after(marker) > 0) ??
        ordered[0])
      : ([...ordered]
          .reverse()
          .find((marker: MonacoApi.editor.IMarker): boolean => after(marker) < 0) ??
        ordered[ordered.length - 1]);
  return {
    startLineNumber: found.startLineNumber,
    startColumn: found.startColumn,
    endLineNumber: found.endLineNumber,
    endColumn: found.endColumn,
  };
}

/**
 * Determines whether a span holds a position, its ends included.
 * @param range The span.
 * @param position The position.
 * @returns Returns true when it does.
 */
export function rangeHolds(range: MonacoApi.IRange, position: MonacoApi.IPosition): boolean {
  const afterStart: boolean =
    position.lineNumber > range.startLineNumber ||
    (position.lineNumber === range.startLineNumber && position.column >= range.startColumn);
  const beforeEnd: boolean =
    position.lineNumber < range.endLineNumber ||
    (position.lineNumber === range.endLineNumber && position.column <= range.endColumn);
  return afterStart && beforeEnd;
}

/**
 * Reads a problem's code, which Monaco holds as text or as text with a link.
 * @param code The code, if any.
 * @returns Returns the code's text, or null when it has none.
 */
function codeOf(code: MonacoApi.editor.IMarker['code']): string | null {
  const value: string | undefined = typeof code === 'string' ? code : code?.value;
  return value !== undefined && value.length > 0 ? value : null;
}

/**
 * Fences a code snippet in a language, with a fence longer than any run of backticks inside it, so the
 * snippet can never close its own fence.
 * @param code The snippet.
 * @param language The language it is written in.
 * @returns Returns the fenced block, as markdown.
 */
export function fenced(code: string, language: string): string {
  const longest: number = Math.max(
    0,
    ...[...code.matchAll(/`+/g)].map((run: RegExpMatchArray): number => run[0].length),
  );
  const fence: string = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

/**
 * Escapes plain text for markdown: every ASCII punctuation character markdown could read as syntax is
 * escaped, and each line break becomes a paragraph break, so the text reads exactly as sent — as
 * Monaco's own plain-text hover does.
 * @param text The plain text.
 * @returns Returns the text, as markdown.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|~$&]/g, '\\$&').replace(/\r?\n/g, '\n\n');
}
