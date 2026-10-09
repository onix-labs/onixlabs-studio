/**
 * The symbols a language server reports for one document (`textDocument/documentSymbol`, #882), in the
 * one shape the editor's navigation reads whichever of the protocol's two answers a server gives.
 */

/**
 * Names the kinds of symbol a server reports, numbered as the Language Server Protocol numbers them
 * (`SymbolKind`). Only the ones the editor's navigation tells apart are named; every other kind is a
 * member like any other.
 */
export const SymbolKind: {
  readonly File: number;
  readonly Module: number;
  readonly Namespace: number;
  readonly Package: number;
  readonly Class: number;
  readonly Method: number;
  readonly Property: number;
  readonly Field: number;
  readonly Constructor: number;
  readonly Enum: number;
  readonly Interface: number;
  readonly Function: number;
  readonly Variable: number;
  readonly Constant: number;
  readonly EnumMember: number;
  readonly Struct: number;
  readonly Event: number;
  readonly Operator: number;
  readonly TypeParameter: number;
} = {
  File: 1,
  Module: 2,
  Namespace: 3,
  Package: 4,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Enum: 10,
  Interface: 11,
  Function: 12,
  Variable: 13,
  Constant: 14,
  EnumMember: 22,
  Struct: 23,
  Event: 24,
  Operator: 25,
  TypeParameter: 26,
};

/**
 * A position in a document, zero-based as the protocol counts.
 */
export interface SymbolPosition {
  /**
   * Gets the zero-based line.
   */
  readonly line: number;

  /**
   * Gets the zero-based character offset in the line.
   */
  readonly character: number;
}

/**
 * A range of a document, from one position to another.
 */
export interface SymbolRange {
  /**
   * Gets where the range starts.
   */
  readonly start: SymbolPosition;

  /**
   * Gets where the range ends.
   */
  readonly end: SymbolPosition;
}

/**
 * A symbol in a document, with the symbols declared inside it.
 */
export interface CodeSymbol {
  /**
   * Gets the symbol's name.
   */
  readonly name: string;

  /**
   * Gets the symbol's kind, a protocol `SymbolKind`.
   */
  readonly kind: number;

  /**
   * Gets the whole extent of the symbol, its body included: what the cursor is inside of.
   */
  readonly range: SymbolRange;

  /**
   * Gets the part that names it — the identifier — which is where going to it lands.
   */
  readonly selectionRange: SymbolRange;

  /**
   * Gets the symbols declared inside it, in document order.
   */
  readonly children: readonly CodeSymbol[];
}

/**
 * The hierarchical answer a server gives a client that supports it.
 */
interface LspDocumentSymbol {
  readonly name: string;
  readonly kind: number;
  readonly range: SymbolRange;
  readonly selectionRange: SymbolRange;
  readonly children?: readonly LspDocumentSymbol[];
}

/**
 * The flat answer an older server gives instead: each symbol with its location and no nesting.
 */
interface LspSymbolInformation {
  readonly name: string;
  readonly kind: number;
  readonly location: { readonly range: SymbolRange };
}

/**
 * Reads a server's answer to `textDocument/documentSymbol` into symbols, nested and in document
 * order. A flat answer is nested by its ranges: a symbol belongs to the innermost one that contains
 * it, which is what its `containerName` names in words.
 * @param result The server's answer.
 * @returns Returns the document's top-level symbols, or empty for an answer that holds none.
 */
export function toCodeSymbols(result: unknown): readonly CodeSymbol[] {
  if (!Array.isArray(result) || result.length === 0) {
    return [];
  }
  const items: readonly unknown[] = result;
  if (items.every(isDocumentSymbol)) {
    return sortByStart(items.map(fromDocumentSymbol));
  }
  const flat: readonly CodeSymbol[] = items
    .filter(isSymbolInformation)
    .map((item: LspSymbolInformation): CodeSymbol => ({
      name: item.name,
      kind: item.kind,
      range: item.location.range,
      selectionRange: item.location.range,
      children: [],
    }));
  return nestByRange(flat);
}

/**
 * Determines whether a range contains a position.
 * @param range The range.
 * @param position The position.
 * @returns Returns true when the position lies within the range, its ends included.
 */
export function rangeContains(range: SymbolRange, position: SymbolPosition): boolean {
  return compare(range.start, position) <= 0 && compare(position, range.end) <= 0;
}

/**
 * Converts a hierarchical symbol, with its children.
 * @param symbol The server's symbol.
 * @returns Returns the symbol.
 */
function fromDocumentSymbol(symbol: LspDocumentSymbol): CodeSymbol {
  return {
    name: symbol.name,
    kind: symbol.kind,
    range: symbol.range,
    selectionRange: symbol.selectionRange,
    children: sortByStart((symbol.children ?? []).map(fromDocumentSymbol)),
  };
}

/**
 * Nests flat symbols by their ranges, each under the innermost symbol that contains it.
 * @param symbols The symbols, in any order.
 * @returns Returns the top-level symbols, nested.
 */
function nestByRange(symbols: readonly CodeSymbol[]): readonly CodeSymbol[] {
  // Outer before inner: by start, then the longer of two that start together.
  const ordered: readonly CodeSymbol[] = [...symbols].sort(
    (left: CodeSymbol, right: CodeSymbol): number =>
      compare(left.range.start, right.range.start) || compare(right.range.end, left.range.end),
  );
  interface Building {
    readonly symbol: CodeSymbol;
    readonly children: Building[];
  }
  const roots: Building[] = [];
  const open: Building[] = [];
  for (const symbol of ordered) {
    while (
      open.length > 0 &&
      !(
        rangeContains(open[open.length - 1].symbol.range, symbol.range.start) &&
        rangeContains(open[open.length - 1].symbol.range, symbol.range.end)
      )
    ) {
      open.pop();
    }
    const node: Building = { symbol, children: [] };
    (open.length > 0 ? open[open.length - 1].children : roots).push(node);
    open.push(node);
  }
  const build: (node: Building) => CodeSymbol = (node: Building): CodeSymbol => ({
    ...node.symbol,
    children: node.children.map(build),
  });
  return roots.map(build);
}

/**
 * Sorts symbols into document order, by where they start.
 * @param symbols The symbols.
 * @returns Returns them in document order.
 */
function sortByStart(symbols: readonly CodeSymbol[]): readonly CodeSymbol[] {
  return [...symbols].sort((left: CodeSymbol, right: CodeSymbol): number =>
    compare(left.range.start, right.range.start),
  );
}

/**
 * Compares two positions.
 * @param left The first position.
 * @param right The second position.
 * @returns Returns a negative number when the first comes first, positive when the second does.
 */
function compare(left: SymbolPosition, right: SymbolPosition): number {
  return left.line - right.line || left.character - right.character;
}

/**
 * Determines whether a value is a hierarchical document symbol.
 * @param value The value.
 * @returns Returns true when it has a name, kind, range and selection range.
 */
function isDocumentSymbol(value: unknown): value is LspDocumentSymbol {
  const candidate: Partial<Record<keyof LspDocumentSymbol, unknown>> | null =
    typeof value === 'object' ? value : null;
  return (
    candidate !== null &&
    typeof candidate.name === 'string' &&
    typeof candidate.kind === 'number' &&
    isRange(candidate.range) &&
    isRange(candidate.selectionRange)
  );
}

/**
 * Determines whether a value is a flat symbol.
 * @param value The value.
 * @returns Returns true when it has a name, kind and location range.
 */
function isSymbolInformation(value: unknown): value is LspSymbolInformation {
  const candidate: Partial<Record<keyof LspSymbolInformation, unknown>> | null =
    typeof value === 'object' ? value : null;
  return (
    candidate !== null &&
    typeof candidate.name === 'string' &&
    typeof candidate.kind === 'number' &&
    typeof candidate.location === 'object' &&
    candidate.location !== null &&
    isRange((candidate.location as { range?: unknown }).range)
  );
}

/**
 * Determines whether a value is a range.
 * @param value The value.
 * @returns Returns true when it has a start and an end position.
 */
function isRange(value: unknown): value is SymbolRange {
  const range: { start?: unknown; end?: unknown } | null = typeof value === 'object' ? value : null;
  return range !== null && isPosition(range.start) && isPosition(range.end);
}

/**
 * Determines whether a value is a position.
 * @param value The value.
 * @returns Returns true when it has a numeric line and character.
 */
function isPosition(value: unknown): value is SymbolPosition {
  const position: { line?: unknown; character?: unknown } | null =
    typeof value === 'object' ? value : null;
  return (
    position !== null && typeof position.line === 'number' && typeof position.character === 'number'
  );
}
