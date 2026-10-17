import { CodeSymbol, SymbolKind, SymbolRange } from '@shared/angular/services/lsp/lsp-symbols';
import {
  buildNavigation,
  GLOBAL_ENTRY_ID,
  locate,
  NavigationLocation,
  NavigationMember,
  NavigationType,
  qualifierFor,
} from './code-navigation';

/**
 * Builds a range over whole lines.
 * @param from The first line, zero-based.
 * @param to The last line, zero-based.
 * @returns Returns the range.
 */
function lines(from: number, to: number): SymbolRange {
  return { start: { line: from, character: 0 }, end: { line: to, character: 80 } };
}

/**
 * Builds a symbol.
 * @param name The name.
 * @param kind The kind.
 * @param from The first line.
 * @param to The last line.
 * @param children The symbols declared inside it.
 * @returns Returns the symbol.
 */
function symbol(
  name: string,
  kind: number,
  from: number,
  to: number,
  children: readonly CodeSymbol[] = [],
): CodeSymbol {
  return { name, kind, range: lines(from, to), selectionRange: lines(from, from), children };
}

/**
 * A C#-shaped file: a namespace holding a class with a nested class, and an enum.
 */
const CSHARP: readonly CodeSymbol[] = [
  symbol('App', SymbolKind.Namespace, 0, 30, [
    symbol('Greeter', SymbolKind.Class, 2, 20, [
      symbol('_name', SymbolKind.Field, 4, 4),
      symbol('Greet', SymbolKind.Method, 6, 9, [symbol('local', SymbolKind.Variable, 7, 7)]),
      symbol('Options', SymbolKind.Class, 11, 18, [symbol('Loud', SymbolKind.Property, 13, 13)]),
    ]),
    symbol('Mood', SymbolKind.Enum, 22, 26, [symbol('Happy', SymbolKind.EnumMember, 24, 24)]),
  ]),
];

/**
 * Gets the labels of entries.
 * @param entries The entries.
 * @returns Returns their labels.
 */
function labels(entries: readonly { readonly label: string }[]): readonly string[] {
  return entries.map((entry: { readonly label: string }): string => entry.label);
}

describe('code navigation (#882)', () => {
  it('listsEveryType_underItsQualifiedName_butNotTheNamespace', () => {
    const types: readonly NavigationType[] = buildNavigation(CSHARP, 'Greeter.cs');

    expect(labels(types)).toEqual(['App.Greeter', 'App.Greeter.Options', 'App.Mood']);
  });

  it('givesEachTypeItsOwnMembers_aNestedTypeBeingATypeNotAMember', () => {
    const types: readonly NavigationType[] = buildNavigation(CSHARP, 'Greeter.cs');

    expect(labels(types[0].members)).toEqual(['_name', 'Greet']);
    expect(labels(types[1].members)).toEqual(['Loud']);
    expect(labels(types[2].members)).toEqual(['Happy']);
  });

  it('putsWhatIsOutsideAnyType_underAnEntryNamedForTheFile_first', () => {
    // A TypeScript module: a class, and functions and a constant beside it.
    const types: readonly NavigationType[] = buildNavigation(
      [
        symbol('VERSION', SymbolKind.Constant, 0, 0),
        symbol('Greeter', SymbolKind.Class, 2, 6, [symbol('greet', SymbolKind.Method, 3, 5)]),
        symbol('main', SymbolKind.Function, 8, 10),
      ],
      'greet.ts',
    );

    expect(labels(types)).toEqual(['greet.ts', 'Greeter']);
    expect(types[0].id).toBe(GLOBAL_ENTRY_ID);
    expect(labels(types[0].members)).toEqual(['VERSION', 'main']);
  });

  it('readsAnEnumsChildrenAsItsValues_whateverKindTheServerGivesThem', () => {
    // clangd reports `enum class Mood { Happy, Sad }`'s enumerators with a type's kind.
    const types: readonly NavigationType[] = buildNavigation(
      [
        symbol('Mood', SymbolKind.Enum, 0, 3, [
          symbol('Happy', SymbolKind.Enum, 1, 1),
          symbol('Sad', SymbolKind.Class, 2, 2),
        ]),
      ],
      'mood.cpp',
    );

    expect(labels(types)).toEqual(['Mood']);
    expect(labels(types[0].members)).toEqual(['Happy', 'Sad']);
  });

  it('qualifiesWithTheLanguagesOwnOperator', () => {
    const types: readonly NavigationType[] = buildNavigation(
      CSHARP,
      'greeter.cpp',
      qualifierFor('cpp'),
    );

    expect(labels(types)).toEqual(['App::Greeter', 'App::Greeter::Options', 'App::Mood']);
    expect(qualifierFor('csharp')).toBe('.');
    expect(qualifierFor('rust')).toBe('::');
  });

  it('hasNoEntries_forAFileWithNoSymbols', () => {
    expect(buildNavigation([], 'empty.ts')).toEqual([]);
  });

  it('locate_findsTheInnermostTypeAndTheMemberTheCursorIsIn', () => {
    const types: readonly NavigationType[] = buildNavigation(CSHARP, 'Greeter.cs');
    const at: (line: number) => NavigationLocation = (line: number): NavigationLocation =>
      locate(types, { line, character: 4 });
    const name: (location: NavigationLocation) => [string | undefined, string | undefined] = (
      location: NavigationLocation,
    ): [string | undefined, string | undefined] => {
      const type: NavigationType | undefined = types.find(
        (entry: NavigationType): boolean => entry.id === location.typeId,
      );
      const member: NavigationMember | undefined = type?.members.find(
        (entry: NavigationMember): boolean => entry.id === location.memberId,
      );
      return [type?.label, member?.label];
    };

    expect(name(at(7))).toEqual(['App.Greeter', 'Greet']);
    expect(name(at(13))).toEqual(['App.Greeter.Options', 'Loud']);
    // Inside a type but between its members.
    expect(name(at(10))).toEqual(['App.Greeter', undefined]);
    // Inside the namespace but in no type.
    expect(at(28)).toEqual({ typeId: null, memberId: null });
  });

  it('locate_findsAMemberAnywhereOnItsLines_pastTheEndOfItsDeclaration', () => {
    // `bool loud = false;` — the server's range ends at the semicolon; the cursor after it is still there.
    const field: CodeSymbol = {
      name: 'loud',
      kind: SymbolKind.Field,
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 21 } },
      selectionRange: { start: { line: 1, character: 9 }, end: { line: 1, character: 13 } },
      children: [],
    };
    const types: readonly NavigationType[] = buildNavigation(
      [symbol('Options', SymbolKind.Struct, 0, 2, [field])],
      'a.cpp',
    );

    expect(locate(types, { line: 1, character: 30 }).memberId).toBe(types[0].members[0].id);
  });

  it('locate_outsideAnyType_isTheFilesEntry_whenItHasOne', () => {
    const types: readonly NavigationType[] = buildNavigation(
      [symbol('main', SymbolKind.Function, 0, 3), symbol('Greeter', SymbolKind.Class, 5, 8)],
      'greet.ts',
    );

    const location: NavigationLocation = locate(types, { line: 1, character: 0 });

    expect(location.typeId).toBe(GLOBAL_ENTRY_ID);
    expect(location.memberId).toBe(types[0].members[0].id);
  });
});
