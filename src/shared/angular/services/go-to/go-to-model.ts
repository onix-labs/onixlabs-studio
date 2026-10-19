import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import { CodeSymbol, SymbolKind, SymbolPosition } from '@shared/angular/services/lsp/lsp-symbols';

/**
 * Names what an editor's Go to asks for (#1009): a symbol of the document, or a line of it.
 */
export type GoToMode = 'symbol' | 'line';

/**
 * Names what one of the Go to surfaces — the quick-open box, or a dialog — asks for: a Go to's symbol
 * or line, or a symbol's new name for Rename Symbol (#1015), which the "Go to style" setting places
 * the same way.
 */
export type GoToSurfaceMode = GoToMode | 'rename';

/**
 * The outcome of reading what was typed as a symbol's new name (#1015).
 */
export interface RenameEntry {
  /**
   * Gets the new name, trimmed, or null while what was typed names no new name: nothing, or the
   * name the symbol already has.
   */
  readonly name: string | null;

  /**
   * Gets the hint shown under the field.
   */
  readonly hint: string;
}

/**
 * Reads what was typed as a symbol's new name (#1015): a name with something in it, and not the one
 * it has now.
 * @param text The entry.
 * @param current The symbol's name as it stands.
 * @returns Returns the new name, if there is one, and the hint to show.
 */
export function parseRenameEntry(text: string, current: string): RenameEntry {
  const name: string = text.trim();
  if (name.length === 0) {
    return { name: null, hint: 'Type the new name' };
  }
  if (name === current) {
    return { name: null, hint: `It is already named “${current}”` };
  }
  return { name, hint: 'Enter to rename, Escape to cancel' };
}

/**
 * A place in a document to go to: a caret position, or the span to select there (a symbol's name).
 * One-based, as the editor counts.
 */
export interface GoToTarget {
  /**
   * Gets the line to go to.
   */
  readonly line: number;

  /**
   * Gets the column to go to.
   */
  readonly column: number;

  /**
   * Gets the line the selection ends on, or undefined to place the caret alone.
   */
  readonly endLine?: number;

  /**
   * Gets the column the selection ends at, or undefined to place the caret alone.
   */
  readonly endColumn?: number;
}

/**
 * One symbol in Go to Symbol's list: a document symbol flattened out of its nesting, with what it is
 * declared in and where its name is.
 */
export interface GoToSymbol {
  /**
   * Gets its identifier, unique in the list.
   */
  readonly id: string;

  /**
   * Gets its name, as the language reports it.
   */
  readonly name: string;

  /**
   * Gets the names of what it is declared in, outermost first and joined as its language joins them
   * (`Outer.Inner`, `app::Greeter`), or empty at the top level.
   */
  readonly container: string;

  /**
   * Gets the icon for its kind.
   */
  readonly icon: Icon;

  /**
   * Gets its name's span, which going to it selects.
   */
  readonly target: GoToTarget;
}

/**
 * The outcome of reading what was typed into a Go to Line field.
 */
export type LineEntry =
  | {
      /**
       * Gets that nothing has been typed yet.
       */
      readonly kind: 'empty';
    }
  | {
      /**
       * Gets that the entry names a line in the document.
       */
      readonly kind: 'valid';

      /**
       * Gets the line, one-based.
       */
      readonly line: number;

      /**
       * Gets the column, one-based, or undefined when only a line was typed.
       */
      readonly column: number | undefined;
    }
  | {
      /**
       * Gets that the entry is not a line in the document.
       */
      readonly kind: 'invalid';
    };

/**
 * Matches a Go to Line entry: a line number, optionally followed by a colon and a column number
 * (`42`, `42:10`), with any spaces around them.
 */
const LINE_ENTRY: RegExp = /^\s*(\d+)\s*(?::\s*(\d+)\s*)?$/;

/**
 * Reads what was typed into a Go to Line field.
 * @param text The entry.
 * @param lineCount The number of lines in the document.
 * @returns Returns the line (and column) it names, or why it names none.
 */
export function parseLineEntry(text: string, lineCount: number): LineEntry {
  if (text.trim().length === 0) {
    return { kind: 'empty' };
  }
  const match: RegExpExecArray | null = LINE_ENTRY.exec(text);
  if (match === null) {
    return { kind: 'invalid' };
  }
  const line: number = Number(match[1]);
  const column: number | undefined = match[2] === undefined ? undefined : Number(match[2]);
  if (line < 1 || line > lineCount || (column !== undefined && column < 1)) {
    return { kind: 'invalid' };
  }
  return { kind: 'valid', line, column };
}

/**
 * Words the hint shown under a Go to Line field: the valid range while nothing is typed, where Enter
 * will go once a line is, and what is wrong otherwise.
 * @param entry The entry, as read.
 * @param lineCount The number of lines in the document.
 * @returns Returns the hint.
 */
export function lineHint(entry: LineEntry, lineCount: number): string {
  switch (entry.kind) {
    case 'empty':
      return lineCount === 1 ? 'Go to line 1' : `Go to line 1–${lineCount}`;
    case 'valid':
      return entry.column === undefined
        ? `Go to line ${entry.line}`
        : `Go to line ${entry.line}, column ${entry.column}`;
    case 'invalid':
      return `Type a line between 1 and ${lineCount}, or line:column`;
  }
}

/**
 * Flattens a document's symbols into Go to Symbol's list, in document order: every symbol at every
 * depth, each naming the symbols it is declared in.
 * @param symbols The document's top-level symbols, nested.
 * @param qualifier What joins a name to what it is declared in: `.`, or `::`.
 * @returns Returns the list.
 */
export function flattenSymbols(
  symbols: readonly CodeSymbol[],
  qualifier: string = '.',
): readonly GoToSymbol[] {
  const flat: GoToSymbol[] = [];
  const visit: (symbol: CodeSymbol, container: string) => void = (
    symbol: CodeSymbol,
    container: string,
  ): void => {
    const start: SymbolPosition = symbol.selectionRange.start;
    const end: SymbolPosition = symbol.selectionRange.end;
    flat.push({
      id: `${container}${qualifier}${symbol.name}@${start.line}:${start.character}:${flat.length}`,
      name: symbol.name,
      container,
      icon: symbolIcon(symbol.kind),
      target: {
        line: start.line + 1,
        column: start.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
      },
    });
    const inner: string =
      container.length === 0 ? symbol.name : `${container}${qualifier}${symbol.name}`;
    for (const child of symbol.children) {
      visit(child, inner);
    }
  };
  for (const symbol of symbols) {
    visit(symbol, '');
  }
  return flat;
}

/**
 * Filters Go to Symbol's list by what has been typed, ignoring case: names that start with it first,
 * then names that contain it, then names that hold its letters in order (`gcn` finds
 * `getCustomerName`). Each group keeps document order.
 * @param symbols The list.
 * @param query What has been typed.
 * @returns Returns the matching symbols, best first; the whole list when nothing is typed.
 */
export function filterSymbols(
  symbols: readonly GoToSymbol[],
  query: string,
): readonly GoToSymbol[] {
  const needle: string = query.trim().toLowerCase();
  if (needle.length === 0) {
    return symbols;
  }
  const prefixed: GoToSymbol[] = [];
  const contained: GoToSymbol[] = [];
  const scattered: GoToSymbol[] = [];
  for (const symbol of symbols) {
    const name: string = symbol.name.toLowerCase();
    if (name.startsWith(needle)) {
      prefixed.push(symbol);
    } else if (name.includes(needle)) {
      contained.push(symbol);
    } else if (holdsInOrder(name, needle)) {
      scattered.push(symbol);
    }
  }
  return [...prefixed, ...contained, ...scattered];
}

/**
 * Moves a list's selection by a step, stopping at either end.
 * @param ids The list's identifiers, in order.
 * @param current The selected identifier, or null when nothing is selected.
 * @param step How far to move: 1 down, -1 up.
 * @returns Returns the newly selected identifier, or null for an empty list.
 */
export function stepSelection(
  ids: readonly string[],
  current: string | null,
  step: number,
): string | null {
  if (ids.length === 0) {
    return null;
  }
  const index: number = current === null ? -1 : ids.indexOf(current);
  if (index < 0) {
    return ids[0];
  }
  return ids[Math.min(ids.length - 1, Math.max(0, index + step))];
}

/**
 * Goes to a place in an editor: selects the target's span (or places the caret), centres it in the
 * viewport, and gives the editor focus so typing carries on from there.
 * @param editor The editor.
 * @param target Where to go.
 */
export function revealTarget(editor: MonacoApi.editor.ICodeEditor, target: GoToTarget): void {
  // Measured first: an editor in a tab just brought forward has not been laid out since it was
  // hidden, and a line centred in a viewport of no height lands at the top once the editor shows.
  editor.layout();
  if (target.endLine !== undefined && target.endColumn !== undefined) {
    const range: MonacoApi.IRange = {
      startLineNumber: target.line,
      startColumn: target.column,
      endLineNumber: target.endLine,
      endColumn: target.endColumn,
    };
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
  } else {
    const position: MonacoApi.IPosition = { lineNumber: target.line, column: target.column };
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
  }
  editor.focus();
}

/**
 * Gets the icon for a symbol kind.
 * @param kind The kind, a protocol `SymbolKind`.
 * @returns Returns the icon.
 */
export function symbolIcon(kind: number): Icon {
  switch (kind) {
    case SymbolKind.Class:
    case SymbolKind.Struct:
      return Icon.SYMBOL_CLASS;
    case SymbolKind.Interface:
      return Icon.SYMBOL_INTERFACE;
    case SymbolKind.Enum:
    case SymbolKind.EnumMember:
      return Icon.SYMBOL_ENUM;
    case SymbolKind.Method:
    case SymbolKind.Function:
    case SymbolKind.Constructor:
      return Icon.SYMBOL_FUNCTION;
    case SymbolKind.Property:
      return Icon.SYMBOL_PROPERTY;
    case SymbolKind.Field:
      return Icon.SYMBOL_FIELD;
    case SymbolKind.Variable:
      return Icon.SYMBOL_VARIABLE;
    case SymbolKind.Constant:
      return Icon.SYMBOL_CONSTANT;
    case SymbolKind.Module:
    case SymbolKind.Namespace:
    case SymbolKind.Package:
    case SymbolKind.File:
      return Icon.SYMBOL_NAMESPACE;
    case SymbolKind.Event:
      return Icon.SYMBOL_EVENT;
    default:
      return Icon.SYMBOL_OTHER;
  }
}

/**
 * Determines whether a name holds every letter of a query, in order.
 * @param name The name, lower-cased.
 * @param needle The query, lower-cased.
 * @returns Returns true when every letter of the query appears in the name in order.
 */
function holdsInOrder(name: string, needle: string): boolean {
  let at: number = 0;
  for (const letter of needle) {
    at = name.indexOf(letter, at);
    if (at < 0) {
      return false;
    }
    at += 1;
  }
  return true;
}
