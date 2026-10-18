import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import { CodeSymbol, SymbolKind } from '@shared/angular/services/lsp/lsp-symbols';
import {
  filterSymbols,
  flattenSymbols,
  GoToSymbol,
  lineHint,
  parseLineEntry,
  revealTarget,
  stepSelection,
  symbolIcon,
} from './go-to-model';

/**
 * Builds a symbol whose name sits on one line.
 * @param name The name.
 * @param kind The kind.
 * @param line The line, zero-based.
 * @param children The symbols inside it.
 * @returns Returns the symbol.
 */
function symbol(
  name: string,
  kind: number,
  line: number,
  children: readonly CodeSymbol[] = [],
): CodeSymbol {
  return {
    name,
    kind,
    range: { start: { line, character: 0 }, end: { line: line + 5, character: 1 } },
    selectionRange: {
      start: { line, character: 4 },
      end: { line, character: 4 + name.length },
    },
    children,
  };
}

/**
 * Builds a flat Go to Symbol entry by name, for the filter.
 * @param name The name.
 * @returns Returns the entry.
 */
function entry(name: string): GoToSymbol {
  return { id: name, name, container: '', icon: Icon.SYMBOL_OTHER, target: { line: 1, column: 1 } };
}

describe('parseLineEntry', () => {
  it('readsALine', () => {
    expect(parseLineEntry('42', 100)).toEqual({ kind: 'valid', line: 42, column: undefined });
  });

  it('readsALineAndColumn_withSpacesAroundThem', () => {
    expect(parseLineEntry(' 42 : 10 ', 100)).toEqual({ kind: 'valid', line: 42, column: 10 });
  });

  it('nothingTyped_isEmpty', () => {
    expect(parseLineEntry('   ', 100)).toEqual({ kind: 'empty' });
  });

  it('aLinePastTheEnd_orBeforeTheStart_isInvalid', () => {
    expect(parseLineEntry('101', 100).kind).toBe('invalid');
    expect(parseLineEntry('0', 100).kind).toBe('invalid');
    expect(parseLineEntry('5:0', 100).kind).toBe('invalid');
  });

  it('anythingButNumbers_isInvalid', () => {
    expect(parseLineEntry('abc', 100).kind).toBe('invalid');
    expect(parseLineEntry('4:', 100).kind).toBe('invalid');
    expect(parseLineEntry('-3', 100).kind).toBe('invalid');
  });
});

describe('lineHint', () => {
  it('namesTheRange_whileNothingIsTyped', () => {
    expect(lineHint({ kind: 'empty' }, 250)).toBe('Go to line 1–250');
    expect(lineHint({ kind: 'empty' }, 1)).toBe('Go to line 1');
  });

  it('namesWhereEnterGoes', () => {
    expect(lineHint({ kind: 'valid', line: 42, column: undefined }, 250)).toBe('Go to line 42');
    expect(lineHint({ kind: 'valid', line: 42, column: 10 }, 250)).toBe('Go to line 42, column 10');
  });

  it('saysWhatIsWrong', () => {
    expect(lineHint({ kind: 'invalid' }, 250)).toBe(
      'Type a line between 1 and 250, or line:column',
    );
  });
});

describe('flattenSymbols', () => {
  it('listsEverySymbolInDocumentOrder_namingWhatEachIsDeclaredIn', () => {
    const flat: readonly GoToSymbol[] = flattenSymbols([
      symbol('app', SymbolKind.Namespace, 0, [
        symbol('Greeter', SymbolKind.Class, 1, [symbol('greet', SymbolKind.Method, 2)]),
      ]),
      symbol('main', SymbolKind.Function, 10),
    ]);

    expect(flat.map((item: GoToSymbol): [string, string] => [item.name, item.container])).toEqual([
      ['app', ''],
      ['Greeter', 'app'],
      ['greet', 'app.Greeter'],
      ['main', ''],
    ]);
    expect(new Set(flat.map((item: GoToSymbol): string => item.id)).size).toBe(4);
  });

  it('targetsTheName_oneBased', () => {
    const [greet]: readonly GoToSymbol[] = flattenSymbols([symbol('greet', SymbolKind.Method, 2)]);

    expect(greet.target).toEqual({ line: 3, column: 5, endLine: 3, endColumn: 10 });
    expect(greet.icon).toBe(Icon.SYMBOL_FUNCTION);
  });

  it('joinsContainers_asTheLanguageDoes', () => {
    const flat: readonly GoToSymbol[] = flattenSymbols(
      [symbol('app', SymbolKind.Namespace, 0, [symbol('Greeter', SymbolKind.Class, 1)])],
      '::',
    );

    expect(flat[1].container).toBe('app');
    expect(
      flattenSymbols(
        [
          symbol('a', SymbolKind.Namespace, 0, [
            symbol('b', SymbolKind.Namespace, 1, [symbol('C', SymbolKind.Class, 2)]),
          ]),
        ],
        '::',
      )[2].container,
    ).toBe('a::b');
  });
});

describe('filterSymbols', () => {
  const symbols: readonly GoToSymbol[] = [
    entry('getCustomerName'),
    entry('customer'),
    entry('Customers'),
    entry('render'),
  ];

  it('nothingTyped_listsEverything', () => {
    expect(filterSymbols(symbols, '  ')).toBe(symbols);
  });

  it('ranksPrefixesThenContainsThenLettersInOrder_ignoringCase', () => {
    expect(filterSymbols(symbols, 'cust').map((item: GoToSymbol): string => item.name)).toEqual([
      'customer',
      'Customers',
      'getCustomerName',
    ]);
    expect(filterSymbols(symbols, 'gcn').map((item: GoToSymbol): string => item.name)).toEqual([
      'getCustomerName',
    ]);
  });

  it('noMatch_isEmpty', () => {
    expect(filterSymbols(symbols, 'zzz')).toEqual([]);
  });
});

describe('stepSelection', () => {
  const ids: readonly string[] = ['a', 'b', 'c'];

  it('movesThroughTheList_stoppingAtEitherEnd', () => {
    expect(stepSelection(ids, 'a', 1)).toBe('b');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
  });

  it('startsAtTheTop_whenNothingIsSelected', () => {
    expect(stepSelection(ids, null, 1)).toBe('a');
    expect(stepSelection(ids, 'gone', -1)).toBe('a');
    expect(stepSelection([], null, 1)).toBeNull();
  });
});

describe('symbolIcon', () => {
  it('drawsEachKindItsOwnWay', () => {
    expect(symbolIcon(SymbolKind.Class)).toBe(Icon.SYMBOL_CLASS);
    expect(symbolIcon(SymbolKind.Struct)).toBe(Icon.SYMBOL_CLASS);
    expect(symbolIcon(SymbolKind.Interface)).toBe(Icon.SYMBOL_INTERFACE);
    expect(symbolIcon(SymbolKind.EnumMember)).toBe(Icon.SYMBOL_ENUM);
    expect(symbolIcon(SymbolKind.Constructor)).toBe(Icon.SYMBOL_FUNCTION);
    expect(symbolIcon(SymbolKind.Field)).toBe(Icon.SYMBOL_FIELD);
    expect(symbolIcon(SymbolKind.Namespace)).toBe(Icon.SYMBOL_NAMESPACE);
    expect(symbolIcon(SymbolKind.TypeParameter)).toBe(Icon.SYMBOL_OTHER);
  });
});

describe('revealTarget', () => {
  /**
   * Builds an editor that records what it is asked to do.
   * @param calls Receives each call, by name.
   * @returns Returns the editor.
   */
  function recorder(calls: unknown[][]): MonacoApi.editor.ICodeEditor {
    const record: (name: string) => (...args: unknown[]) => void =
      (name: string) =>
      (...args: unknown[]): void =>
        void calls.push([name, ...args]);
    return {
      layout: record('layout'),
      setPosition: record('setPosition'),
      revealPositionInCenter: record('revealPositionInCenter'),
      setSelection: record('setSelection'),
      revealRangeInCenter: record('revealRangeInCenter'),
      focus: record('focus'),
    } as unknown as MonacoApi.editor.ICodeEditor;
  }

  it('placesTheCaret_centresIt_andFocuses', () => {
    const calls: unknown[][] = [];

    revealTarget(recorder(calls), { line: 42, column: 10 });

    expect(calls).toEqual([
      ['layout'],
      ['setPosition', { lineNumber: 42, column: 10 }],
      ['revealPositionInCenter', { lineNumber: 42, column: 10 }],
      ['focus'],
    ]);
  });

  it('selectsASymbolsName_whenTheTargetHasAnEnd', () => {
    const calls: unknown[][] = [];
    const range: MonacoApi.IRange = {
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 10,
    };

    revealTarget(recorder(calls), { line: 3, column: 5, endLine: 3, endColumn: 10 });

    expect(calls).toEqual([
      ['layout'],
      ['setSelection', range],
      ['revealRangeInCenter', range],
      ['focus'],
    ]);
  });
});
