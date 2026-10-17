import {
  CodeSymbol,
  rangeContains,
  SymbolKind,
  SymbolPosition,
  SymbolRange,
} from '@shared/angular/services/lsp/lsp-symbols';

/**
 * The kinds the Type dropdown lists: what declares members.
 */
const TYPE_KINDS: ReadonlySet<number> = new Set<number>([
  SymbolKind.Class,
  SymbolKind.Interface,
  SymbolKind.Enum,
  SymbolKind.Struct,
]);

/**
 * The kinds that hold types without being one — a namespace or module — so they name the types inside
 * them but are not listed themselves.
 */
const CONTAINER_KINDS: ReadonlySet<number> = new Set<number>([
  SymbolKind.Module,
  SymbolKind.Namespace,
  SymbolKind.Package,
]);

/**
 * The languages that qualify a name with `::` (`app::Greeter`) rather than `.`.
 */
const SCOPE_OPERATOR_LANGUAGES: ReadonlySet<string> = new Set<string>(['c', 'cpp', 'rust']);

/**
 * Gets how a language joins a type's name to what it is declared in.
 * @param language The document's language identifier.
 * @returns Returns `::` for the languages that write it, and `.` for the rest.
 */
export function qualifierFor(language: string): string {
  return SCOPE_OPERATOR_LANGUAGES.has(language) ? '::' : '.';
}

/**
 * The identifier of the entry for what is declared outside any type: a module's functions, a script's
 * variables.
 */
export const GLOBAL_ENTRY_ID: string = 'global';

/**
 * A place in the document the navigation goes to: where an entry is declared, and all it covers.
 */
export interface NavigationTarget {
  /**
   * Gets the whole extent of the declaration, which decides whether the cursor is inside it.
   */
  readonly range: SymbolRange;

  /**
   * Gets the name in the declaration, where going to it puts the cursor.
   */
  readonly selection: SymbolRange;
}

/**
 * A member in the Member dropdown.
 */
export interface NavigationMember extends NavigationTarget {
  /**
   * Gets its identifier, unique in the document.
   */
  readonly id: string;

  /**
   * Gets its label: its name as the server gives it.
   */
  readonly label: string;
}

/**
 * A type in the Type dropdown, with the members the Member dropdown shows while it is chosen.
 */
export interface NavigationType {
  /**
   * Gets its identifier, unique in the document.
   */
  readonly id: string;

  /**
   * Gets its label: its name, qualified by the types and namespaces it is declared in.
   */
  readonly label: string;

  /**
   * Gets where it is declared, or null for the entry of what lies outside any type.
   */
  readonly target: NavigationTarget | null;

  /**
   * Gets its members, in document order. A nested type is not one: it is a type of its own.
   */
  readonly members: readonly NavigationMember[];
}

/**
 * What the cursor is in: the type, and the member of it.
 */
export interface NavigationLocation {
  /**
   * Gets the identifier of the type the cursor is in, or null when it is in none.
   */
  readonly typeId: string | null;

  /**
   * Gets the identifier of the member the cursor is in, or null when it is in none.
   */
  readonly memberId: string | null;
}

/**
 * Builds the Type dropdown's entries from a document's symbols (#882): every type, however deeply
 * nested, under its qualified name, each with its members — and, first, an entry named for the file
 * holding whatever is declared outside any type, when anything is.
 * @param symbols The document's top-level symbols.
 * @param fileName The document's file name, which names the outside-any-type entry.
 * @param qualifier What joins a name to what it is declared in: `.`, or `::` (see {@link qualifierFor}).
 * @returns Returns the types, in document order.
 */
export function buildNavigation(
  symbols: readonly CodeSymbol[],
  fileName: string,
  qualifier: string = '.',
): readonly NavigationType[] {
  const types: NavigationType[] = [];
  const global: NavigationMember[] = [];
  // The member lists that belong to enums, so what is declared in one is read as its values.
  const inEnum: Set<NavigationMember[]> = new Set<NavigationMember[]>();
  const visit: (symbol: CodeSymbol, prefix: string, inType: NavigationMember[] | null) => void = (
    symbol: CodeSymbol,
    prefix: string,
    inType: NavigationMember[] | null,
  ): void => {
    // Inside an enum everything is one of its values, whatever kind the server gives it: clangd, for
    // one, does not report an enumerator as an enum member.
    if (TYPE_KINDS.has(symbol.kind) && !(inType !== null && inEnum.has(inType))) {
      const label: string = `${prefix}${symbol.name}`;
      const id: string = `${label}@${symbol.range.start.line}`;
      const members: NavigationMember[] = [];
      if (symbol.kind === SymbolKind.Enum) {
        inEnum.add(members);
      }
      types.push({ id, label, target: targetOf(symbol), members });
      for (const child of symbol.children) {
        visit(child, `${label}${qualifier}`, members);
      }
      return;
    }
    if (CONTAINER_KINDS.has(symbol.kind)) {
      for (const child of symbol.children) {
        visit(child, `${prefix}${symbol.name}${qualifier}`, inType);
      }
      return;
    }
    // A member: of the type it is declared in, or of the file. What is declared inside it (a local
    // function, a nested type in a method) belongs to it, not to the dropdowns.
    const owner: NavigationMember[] = inType ?? global;
    owner.push({
      id: `${prefix}${symbol.name}@${symbol.range.start.line}:${symbol.range.start.character}`,
      label: symbol.name,
      ...targetOf(symbol),
    });
  };
  for (const symbol of symbols) {
    visit(symbol, '', null);
  }
  if (global.length === 0) {
    return types;
  }
  return [{ id: GLOBAL_ENTRY_ID, label: fileName, target: null, members: global }, ...types];
}

/**
 * Finds what the cursor is in: the innermost type whose declaration contains it (or the file's entry,
 * when no type does and the file has one), and the member of that type on whose lines it is.
 * @param types The Type dropdown's entries.
 * @param position The cursor, zero-based.
 * @returns Returns the type and member, either null when the cursor is in none.
 */
export function locate(
  types: readonly NavigationType[],
  position: SymbolPosition,
): NavigationLocation {
  // The types are listed outer before inner, so the last that contains the cursor is the innermost.
  let innermost: NavigationType | null = null;
  for (const type of types) {
    if (type.target !== null && rangeContains(type.target.range, position)) {
      innermost = type;
    }
  }
  const type: NavigationType | null =
    innermost ??
    types.find((entry: NavigationType): boolean => entry.id === GLOBAL_ENTRY_ID) ??
    null;
  // A member is matched by its lines rather than its exact extent: a server's range for a field stops
  // at the end of its declaration, and a cursor after it on the same line is still at that field.
  const member: NavigationMember | undefined = type?.members.find(
    (entry: NavigationMember): boolean =>
      entry.range.start.line <= position.line && position.line <= entry.range.end.line,
  );
  return { typeId: type?.id ?? null, memberId: member?.id ?? null };
}

/**
 * Gets where a symbol is declared.
 * @param symbol The symbol.
 * @returns Returns its extent and its name's range.
 */
function targetOf(symbol: CodeSymbol): NavigationTarget {
  return { range: symbol.range, selection: symbol.selectionRange };
}
