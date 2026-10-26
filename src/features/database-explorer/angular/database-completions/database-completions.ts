import { effect, inject, Service, untracked } from '@angular/core';
import {
  CompletionName,
  CompletionNameKind,
  DatabaseEngineInfo,
  NamesScope,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { DatabaseClient } from '../database-client/database-client';
import { DatabaseWorkspace, OpenSession } from '../database-workspace/database-workspace';

/**
 * What the text before the caret asks to be completed with.
 *
 * - `objects`: a bare word — the names a query reaches for first, and in SQL the columns of the
 *   tables it already names.
 * - `members`: after `x.` — the columns (or a label's property keys) of the object `x` is or stands
 *   for, or the objects of the schema `x` names.
 * - `labels` / `relationships`: in Cypher, after `(n:` and `[r:`.
 */
export type CompletionWant =
  | { readonly kind: 'objects' }
  | { readonly kind: 'members'; readonly of: string }
  | { readonly kind: 'labels' }
  | { readonly kind: 'relationships' };

/**
 * One completion, ready for the editor.
 */
export interface QueryCompletion {
  /**
   * Gets the name, as the list shows it.
   */
  readonly label: string;

  /**
   * Gets what it is.
   */
  readonly kind: CompletionNameKind;

  /**
   * Gets the note shown beside it.
   */
  readonly detail?: string;

  /**
   * Gets what accepting it inserts — the name, quoted when the language needs it to be.
   */
  readonly insertText: string;
}

/**
 * The most tables whose columns a bare word is completed with, so a query naming many does not ask the
 * engine for every one at each keystroke.
 */
const MAX_REFERENCED: number = 6;

/**
 * A name as a query writes it, quoted or not, qualified or not.
 */
const NAME: string = String.raw`(?:"(?:[^"]|"")*"|\x60(?:[^\x60]|\x60\x60)*\x60|\[[^\]]*\]|[\p{L}_][\p{L}\p{N}_$]*)`;

/**
 * A possibly qualified name.
 */
const QUALIFIED: string = String.raw`${NAME}(?:\s*\.\s*${NAME})*`;

/**
 * The words that end a table reference rather than alias it (`FROM orders WHERE …`).
 */
const NOT_ALIASES: ReadonlySet<string> = new Set<string>([
  'where',
  'on',
  'using',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'natural',
  'group',
  'order',
  'limit',
  'offset',
  'having',
  'union',
  'except',
  'intersect',
  'set',
  'values',
  'select',
  'returning',
  'window',
  'as',
  'with',
  'for',
  'into',
  'default',
  'and',
  'or',
]);

/**
 * Comments and string literals, closed or not: `-- …` and `// …` to the end of the line, `/* … *\/`
 * (or to the end of the text), and `'…'` with `''` inside.
 */
const LITERALS: RegExp = /--[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*'?/g;

/**
 * Removes the spaces around a qualified name's dots, and nowhere else — a quoted part keeps its own.
 * @param name The name.
 * @returns Returns it with its dots closed up.
 */
function normalise(name: string): string {
  return nameParts(name).join('.');
}

/**
 * Splits a qualified name into its parts, each still as written (quotes included).
 * @param name The name.
 * @returns Returns the parts.
 */
function nameParts(name: string): readonly string[] {
  return [...name.matchAll(new RegExp(NAME, 'gu'))].map(
    (match: RegExpMatchArray): string => match[0],
  );
}

/**
 * Unquotes one name part.
 * @param part The part.
 * @returns Returns it without its quotes.
 */
function unquote(part: string): string {
  if (part.startsWith('"') && part.endsWith('"')) {
    return part.slice(1, -1).replaceAll('""', '"');
  }
  if (part.startsWith('`') && part.endsWith('`')) {
    return part.slice(1, -1).replaceAll('``', '`');
  }
  if (part.startsWith('[') && part.endsWith(']')) {
    return part.slice(1, -1);
  }
  return part;
}

/**
 * Removes comments and the contents of string literals, so a name in either is never taken for a
 * reference. Lengths are kept, so offsets still line up.
 * @param text The query.
 * @returns Returns the text with those spans blanked.
 */
function blankLiterals(text: string): string {
  return text.replace(LITERALS, (span: string): string => span.replace(/[^\n]/g, ' '));
}

/**
 * Determines whether text ends inside a comment or a string literal — an unclosed one.
 * @param before The text before the caret.
 * @returns Returns true when the caret is inside one.
 */
function insideLiteral(before: string): boolean {
  for (const match of before.matchAll(LITERALS)) {
    if ((match.index ?? 0) + match[0].length !== before.length) {
      continue;
    }
    const span: string = match[0];
    if (span.startsWith('--') || span.startsWith('//')) {
      return true;
    }
    if (span.startsWith('/*')) {
      return !span.endsWith('*/') || span.length < 4;
    }
    return !/^'(?:[^']|'')*'$/.test(span);
  }
  return false;
}

/**
 * Works out what the text before the caret asks to be completed with.
 * @param text The query.
 * @param offset The caret's offset.
 * @param language The query's language (`sql`, `pgsql`, `cypher`).
 * @returns Returns what to complete with, or null inside a comment or a string.
 */
export function completionWant(
  text: string,
  offset: number,
  language: string,
): CompletionWant | null {
  const before: string = text.slice(0, offset);
  if (insideLiteral(before)) {
    return null;
  }
  const blanked: string = blankLiterals(before);
  const head: string = blanked.replace(/[\p{L}\p{N}_$]*$/u, '');
  const qualifier: RegExpExecArray | null = new RegExp(
    String.raw`(${QUALIFIED})\s*\.\s*$`,
    'u',
  ).exec(head);
  if (qualifier !== null) {
    const written: string = qualifier[1];
    const alias: string | undefined = aliases(text, language).get(unquote(written).toLowerCase());
    return { kind: 'members', of: alias ?? written };
  }
  if (language === 'cypher') {
    // Only the text since the last open bracket is read, and each repeated part must consume a name,
    // so neither pattern can backtrack on a long line.
    const opened: number = Math.max(head.lastIndexOf('('), head.lastIndexOf('['));
    const inner: string = opened < 0 ? '' : head.slice(opened);
    if (/^\(\s*[\p{L}\p{N}_]*\s*(?::\s*[\p{L}\p{N}_`]+\s*)*:\s*$/u.test(inner)) {
      return { kind: 'labels' };
    }
    if (/^\[\s*[\p{L}\p{N}_]*\s*:\s*(?:[\p{L}\p{N}_`]+\s*\|\s*)*$/u.test(inner)) {
      return { kind: 'relationships' };
    }
  }
  return { kind: 'objects' };
}

/**
 * Maps each alias (and each table's own last name part) a query declares to what it stands for: in
 * SQL `FROM orders o` and `JOIN public.customers AS c`; in Cypher `(m:Movie)` and `[r:ACTED_IN]`.
 * Keys are lower case.
 * @param text The query.
 * @param language The query's language.
 * @returns Returns the aliases.
 */
export function aliases(text: string, language: string): ReadonlyMap<string, string> {
  const found: Map<string, string> = new Map<string, string>();
  const source: string = blankLiterals(text);
  if (language === 'cypher') {
    const pattern: RegExp = new RegExp(
      String.raw`[(\[]\s*([\p{L}_][\p{L}\p{N}_]*)\s*:\s*(${NAME})`,
      'gu',
    );
    for (const match of source.matchAll(pattern)) {
      found.set(match[1].toLowerCase(), match[2]);
    }
    return found;
  }
  const pattern: RegExp = new RegExp(
    // The alias may not be a keyword: `FROM orders JOIN items i` must leave `JOIN` to start the next
    // reference rather than spend it as `orders`'s alias.
    String.raw`\b(?:from|join|update|into)\s+(${QUALIFIED})(?:\s+(?:as\s+)?(?!(?:${[...NOT_ALIASES].join('|')})\b)([\p{L}_][\p{L}\p{N}_$]*))?`,
    'giu',
  );
  for (const match of source.matchAll(pattern)) {
    const table: string = normalise(match[1]);
    const parts: readonly string[] = nameParts(table);
    found.set(unquote(parts[parts.length - 1] ?? table).toLowerCase(), table);
    const alias: string | undefined = match[2];
    if (alias !== undefined) {
      found.set(alias.toLowerCase(), table);
    }
  }
  return found;
}

/**
 * Quotes a name for the language when it must be: Cypher in backticks unless it is a plain
 * identifier; PostgreSQL in double quotes unless it is one in lower case (an unquoted name folds);
 * other SQL in double quotes unless it is a plain identifier.
 * @param name The name.
 * @param language The query's language.
 * @returns Returns the name as it is to be inserted.
 */
export function quoteFor(name: string, language: string): string {
  if (language === 'cypher') {
    return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `\`${name.replaceAll('`', '``')}\``;
  }
  const plain: RegExp = language === 'pgsql' ? /^[a-z_][a-z0-9_$]*$/ : /^[\p{L}_][\p{L}\p{N}_$]*$/u;
  return plain.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

/**
 * The names cached for one session in one database.
 */
interface CachedNames {
  objects: Promise<readonly CompletionName[]> | null;
  readonly members: Map<string, Promise<readonly CompletionName[]>>;
}

/**
 * Completes a query's names from its connection's engine (#1098): lazily, as each is first wanted, and
 * cached per session and database — the objects on the first completion, an object's members only
 * when the query names it. The cache is dropped whenever a run finishes or a session opens or closes,
 * since either may have changed what exists. A query whose connection is closed, or whose engine does
 * not declare `completion`, completes with nothing; completing never connects.
 *
 * Provided by the Database Explorer view, so it lives as long as the tab.
 */
@Service()
export class DatabaseCompletions {
  /**
   * Holds the workspace the queries, connections and sessions are read from.
   */
  private readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);

  /**
   * Holds the client the names are asked for through.
   */
  private readonly client: DatabaseClient = inject(DatabaseClient);

  /**
   * Holds the cached names, by session and database.
   */
  private readonly cache: Map<string, CachedNames> = new Map<string, CachedNames>();

  /**
   * Initializes the completions, dropping the cache as runs finish and sessions change.
   */
  public constructor() {
    effect((): void => {
      this.workspace.outcomes();
      this.workspace.sessions();
      untracked((): void => this.cache.clear());
    });
  }

  /**
   * Completes the word at the caret of a query.
   * @param queryId The query's id.
   * @param text The query's text.
   * @param offset The caret's offset.
   * @returns Returns a promise resolving the completions.
   */
  public async complete(
    queryId: string,
    text: string,
    offset: number,
  ): Promise<readonly QueryCompletion[]> {
    const query: DatabaseQuery | undefined = this.workspace.query(queryId);
    const connection: DatabaseConnection | undefined = this.workspace.connection(
      query?.connectionId ?? null,
    );
    const session: OpenSession | undefined =
      connection === undefined ? undefined : this.workspace.sessions().get(connection.id);
    const engine: DatabaseEngineInfo | undefined =
      connection === undefined ? undefined : this.workspace.engine(connection.engine);
    if (
      query === undefined ||
      session === undefined ||
      engine?.capabilities.includes('completion') !== true
    ) {
      return [];
    }
    const language: string = engine.language;
    const want: CompletionWant | null = completionWant(text, offset, language);
    if (want === null) {
      return [];
    }
    const names: readonly CompletionName[] = await this.namesFor(
      want,
      text,
      language,
      session.session,
      query.database,
    );
    const seen: Set<string> = new Set<string>();
    return names
      .filter((name: CompletionName): boolean => {
        const key: string = `${name.kind}\u0000${name.name}`;
        return !seen.has(key) && (seen.add(key), true);
      })
      .map((name: CompletionName): QueryCompletion => ({
        label: name.name,
        kind: name.kind,
        ...(name.detail === undefined ? {} : { detail: name.detail }),
        insertText: quoteFor(name.name, language),
      }));
  }

  /**
   * Gets the names one want is completed with.
   * @param want What to complete with.
   * @param text The query's text.
   * @param language The query's language.
   * @param session The session.
   * @param database The query's database, when it has one.
   * @returns Returns a promise resolving the names.
   */
  private async namesFor(
    want: CompletionWant,
    text: string,
    language: string,
    session: string,
    database: string | undefined,
  ): Promise<readonly CompletionName[]> {
    const ask: (scope: NamesScope) => Promise<readonly CompletionName[]> = (
      scope: NamesScope,
    ): Promise<readonly CompletionName[]> => this.cached(session, database, scope);
    switch (want.kind) {
      case 'labels':
        return (await ask({ kind: 'objects' })).filter(
          (name: CompletionName) => name.kind === 'label',
        );
      case 'relationships':
        return (await ask({ kind: 'objects' })).filter(
          (name: CompletionName) => name.kind === 'relationship',
        );
      case 'members': {
        const members: readonly CompletionName[] = await ask({ kind: 'members', of: want.of });
        if (members.length > 0 || language === 'cypher') {
          return members;
        }
        // `public.` names a schema rather than a table: offer the objects that are in it.
        const schema: string = unquote(want.of.trim());
        return (await ask({ kind: 'objects' })).filter(
          (name: CompletionName): boolean =>
            name.kind !== 'schema' && name.kind !== 'function' && name.detail === schema,
        );
      }
      case 'objects': {
        const objects: readonly CompletionName[] = await ask({ kind: 'objects' });
        if (language === 'cypher') {
          return objects;
        }
        const referenced: readonly string[] = [
          ...new Set<string>(aliases(text, language).values()),
        ].slice(0, MAX_REFERENCED);
        const columns: readonly (readonly CompletionName[])[] = await Promise.all(
          referenced.map((table: string) => ask({ kind: 'members', of: table })),
        );
        // A referenced table's columns first: in `SELECT … FROM orders` they are what is wanted.
        return [...columns.flat(), ...objects];
      }
    }
  }

  /**
   * Gets names from the cache, asking the engine on a miss.
   * @param session The session.
   * @param database The database, when the query names one.
   * @param scope Which names.
   * @returns Returns a promise resolving the names.
   */
  private cached(
    session: string,
    database: string | undefined,
    scope: NamesScope,
  ): Promise<readonly CompletionName[]> {
    const key: string = `${session}\u0000${database ?? ''}`;
    let entry: CachedNames | undefined = this.cache.get(key);
    if (entry === undefined) {
      entry = { objects: null, members: new Map<string, Promise<readonly CompletionName[]>>() };
      this.cache.set(key, entry);
    }
    const request: () => Promise<readonly CompletionName[]> = (): Promise<
      readonly CompletionName[]
    > => this.client.names({ session, ...(database === undefined ? {} : { database }), scope });
    if (scope.kind === 'objects') {
      entry.objects ??= request();
      return entry.objects;
    }
    const member: string = normalise(scope.of);
    let found: Promise<readonly CompletionName[]> | undefined = entry.members.get(member);
    if (found === undefined) {
      found = request();
      entry.members.set(member, found);
    }
    return found;
  }
}
