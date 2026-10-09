import { CodeSymbol, rangeContains, SymbolKind, SymbolRange, toCodeSymbols } from './lsp-symbols';

/**
 * Builds a range over whole lines.
 * @param from The first line, zero-based.
 * @param to The last line, zero-based.
 * @returns Returns the range.
 */
function lines(from: number, to: number): SymbolRange {
  return { start: { line: from, character: 0 }, end: { line: to, character: 1 } };
}

describe('lsp-symbols (#882)', () => {
  it('readsAHierarchicalAnswer_keepingItsNesting_inDocumentOrder', () => {
    const symbols: readonly CodeSymbol[] = toCodeSymbols([
      {
        name: 'Greeter',
        kind: SymbolKind.Class,
        range: lines(0, 9),
        selectionRange: lines(0, 0),
        children: [
          {
            name: 'greet',
            kind: SymbolKind.Method,
            range: lines(5, 8),
            selectionRange: lines(5, 5),
          },
          { name: 'name', kind: SymbolKind.Field, range: lines(1, 1), selectionRange: lines(1, 1) },
        ],
      },
    ]);

    expect(symbols.map((symbol: CodeSymbol): string => symbol.name)).toEqual(['Greeter']);
    // Sorted by where they start, whatever order the server listed them in.
    expect(symbols[0].children.map((symbol: CodeSymbol): string => symbol.name)).toEqual([
      'name',
      'greet',
    ]);
  });

  it('nestsAFlatAnswer_byItsRanges', () => {
    // An older server sends SymbolInformation: each symbol on its own, located but not nested.
    const at: (name: string, kind: number, range: SymbolRange) => unknown = (
      name: string,
      kind: number,
      range: SymbolRange,
    ): unknown => ({
      name,
      kind,
      location: { uri: 'file:///a.py', range },
    });
    const symbols: readonly CodeSymbol[] = toCodeSymbols([
      at('greet', SymbolKind.Method, lines(2, 4)),
      at('Greeter', SymbolKind.Class, lines(0, 9)),
      at('main', SymbolKind.Function, lines(11, 12)),
    ]);

    expect(symbols.map((symbol: CodeSymbol): string => symbol.name)).toEqual(['Greeter', 'main']);
    expect(symbols[0].children.map((symbol: CodeSymbol): string => symbol.name)).toEqual(['greet']);
  });

  it('readsNothing_fromAnAnswerThatHoldsNoSymbols', () => {
    expect(toCodeSymbols(null)).toEqual([]);
    expect(toCodeSymbols([])).toEqual([]);
    expect(toCodeSymbols([{ name: 'broken' }])).toEqual([]);
  });

  it('rangeContains_includesBothEnds', () => {
    const range: SymbolRange = { start: { line: 1, character: 4 }, end: { line: 3, character: 2 } };

    expect(rangeContains(range, { line: 1, character: 4 })).toBe(true);
    expect(rangeContains(range, { line: 3, character: 2 })).toBe(true);
    expect(rangeContains(range, { line: 1, character: 3 })).toBe(false);
    expect(rangeContains(range, { line: 3, character: 3 })).toBe(false);
  });
});
