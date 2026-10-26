/**
 * The plugin runs under plain Node, and so does this spec, as `node:sqlite`'s values are Node's own.
 * @vitest-environment node
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CompletionName, DatabaseNode, NodeActionOutcome } from '../../protocol/database/protocol';
import { encodePath, EngineSession } from '../../protocol/database/engine';
import { SqliteEngine } from './sqlite-engine';

/**
 * A schema with something in every folder: tables joined by a foreign key, a unique constraint (whose
 * automatic index SQLite names `sqlite_…` and the tree leaves out), an explicit index, a view and a
 * trigger.
 */
const SCHEMA: string = `
create table authors (id integer primary key, name text not null unique);
create table books (
  id integer primary key,
  title text not null default 'untitled',
  author_id integer references authors (id),
  notes
);
create index books_by_title on books (title);
create view titles as select title from books;
create trigger books_touch after insert on books begin select 1; end;
`;

describe('SqliteEngine', (): void => {
  let directory: string;
  let file: string;
  let sessions: EngineSession[];

  beforeEach((): void => {
    // Resolved, as SQLite reports the file by its real path (macOS's temporary directory is a link).
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'sqlite-engine-')));
    file = join(directory, 'library.db');
    const seed: DatabaseSync = new DatabaseSync(file);
    seed.exec(SCHEMA);
    seed.close();
    sessions = [];
  });

  afterEach(async (): Promise<void> => {
    for (const session of sessions) {
      await session.close();
    }
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Opens the seeded database. The runner process is started only by an execution, which these tests
   * do not run, so the bundle path is never used.
   * @returns Returns the session.
   */
  async function open(): Promise<EngineSession> {
    const session: EngineSession = await new SqliteEngine('/unused/main.js').connect({ file });
    sessions.push(session);
    return session;
  }

  /**
   * Lists the children of a path given as segments.
   * @param session The session.
   * @param segments The path's segments.
   * @returns Returns the children.
   */
  function expand(session: EngineSession, ...segments: string[]): Promise<readonly DatabaseNode[]> {
    return session.expand(encodePath(...segments));
  }

  it('info_offersAFileAndReadOnlyField_andCancelScriptAndCompletion', (): void => {
    const engine: SqliteEngine = new SqliteEngine('/unused/main.js');

    expect(engine.info.id).toBe('sqlite');
    expect(engine.info.capabilities).toEqual(['cancel', 'script', 'completion']);
    expect(engine.info.connectionFields.map((field: { id: string }): string => field.id)).toEqual([
      'file',
      'readOnly',
    ]);
    expect(
      engine.info.connectionFields.map(
        (field: { section?: string }): string | undefined => field.section,
      ),
    ).toEqual(['server', 'options']);
  });

  it('connect_refusesAnEmptyFile', async (): Promise<void> => {
    await expect(new SqliteEngine('/unused/main.js').connect({ file: '  ' })).rejects.toThrow(
      'Choose a database file.',
    );
  });

  it('connect_refusesAFileThatCannotBeOpened', async (): Promise<void> => {
    await expect(
      new SqliteEngine('/unused/main.js').connect({ file: join(directory, 'missing', 'x.db') }),
    ).rejects.toThrow();
  });

  it('connect_reportsTheSqliteVersion', async (): Promise<void> => {
    expect((await open()).serverVersion).toMatch(/^SQLite \d+\.\d+/);
  });

  it('expand_listsTheMainSchemaAtTheTop', async (): Promise<void> => {
    const nodes: readonly DatabaseNode[] = await (await open()).expand(null);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      path: encodePath('main'),
      label: 'main',
      detail: undefined,
      icon: 'database',
      leaf: false,
    });
    expect(nodes[0].properties).toContainEqual({ name: 'File', value: file });
  });

  it('expand_listsTheObjectFoldersWithTheirCounts_leavingOutSqlitesOwn', async (): Promise<void> => {
    const nodes: readonly DatabaseNode[] = await expand(await open(), 'main');

    expect(
      nodes.map((node: DatabaseNode): [string, string | undefined, boolean] => [
        node.label,
        node.detail,
        node.leaf,
      ]),
    ).toEqual([
      ['Tables', '2', false],
      ['Views', '1', false],
      // The unique constraint's automatic index is SQLite's, not the user's.
      ['Indexes', '1', false],
      ['Triggers', '1', false],
    ]);
    expect(nodes[0].path).toBe(encodePath('main', 'table'));
  });

  it('expand_marksAnEmptyFolderAsALeaf', async (): Promise<void> => {
    const empty: DatabaseSync = new DatabaseSync(file);
    empty.exec('drop trigger books_touch');
    empty.close();

    const nodes: readonly DatabaseNode[] = await expand(await open(), 'main');

    expect(nodes[3]).toMatchObject({ label: 'Triggers', detail: '0', leaf: true });
  });

  it('expand_listsTablesByName_withTheirActions', async (): Promise<void> => {
    const nodes: readonly DatabaseNode[] = await expand(await open(), 'main', 'table');

    expect(nodes.map((node: DatabaseNode): string => node.label)).toEqual(['authors', 'books']);
    expect(nodes[1]).toMatchObject({
      path: encodePath('main', 'table', 'books'),
      icon: 'table',
      leaf: false,
    });
    expect(nodes[1].actions?.map((action: { id: string }): string => action.id)).toEqual([
      'select-top',
      'script-create',
      'script-insert',
    ]);
  });

  it('expand_listsIndexesAndTriggersAsLeaves_namingTheirTable', async (): Promise<void> => {
    const session: EngineSession = await open();

    expect(await expand(session, 'main', 'index')).toEqual([
      expect.objectContaining({
        label: 'books_by_title',
        detail: 'books',
        icon: 'index',
        leaf: true,
        actions: [{ id: 'script-create', label: 'Script as CREATE' }],
      }),
    ]);
    expect(await expand(session, 'main', 'trigger')).toEqual([
      expect.objectContaining({ label: 'books_touch', detail: 'books', icon: 'trigger' }),
    ]);
  });

  it('expand_givesATableColumnsIndexesAndKeys_butAViewOnlyColumns', async (): Promise<void> => {
    const session: EngineSession = await open();

    expect(
      (await expand(session, 'main', 'table', 'books')).map(
        (node: DatabaseNode): string => node.label,
      ),
    ).toEqual(['Columns', 'Indexes', 'Foreign Keys']);
    expect(
      (await expand(session, 'main', 'view', 'titles')).map(
        (node: DatabaseNode): string => node.label,
      ),
    ).toEqual(['Columns']);
  });

  it('expand_describesEachColumn', async (): Promise<void> => {
    const columns: readonly DatabaseNode[] = await expand(
      await open(),
      'main',
      'table',
      'books',
      'columns',
    );

    expect(
      columns.map((node: DatabaseNode): [string, string | undefined, string] => [
        node.label,
        node.detail,
        node.icon,
      ]),
    ).toEqual([
      ['id', 'INTEGER, PK', 'key'],
      ['title', 'TEXT, not null', 'column'],
      ['author_id', 'INTEGER', 'column'],
      // A column declared with no type takes any.
      ['notes', 'ANY', 'column'],
    ]);
    expect(columns[1].properties).toContainEqual({ name: 'Default', value: "'untitled'" });
    expect(columns[2].properties).toContainEqual({ name: 'Default', value: '(none)' });
    expect(columns.every((node: DatabaseNode): boolean => node.leaf)).toBe(true);
  });

  it('expand_listsATablesIndexes_andItsForeignKeys', async (): Promise<void> => {
    const session: EngineSession = await open();

    const indexes: readonly DatabaseNode[] = await expand(
      session,
      'main',
      'table',
      'authors',
      'indexes',
    );
    expect(indexes).toEqual([
      expect.objectContaining({ label: 'sqlite_autoindex_authors_1', detail: 'unique' }),
    ]);
    const keys: readonly DatabaseNode[] = await expand(session, 'main', 'table', 'books', 'keys');
    expect(keys.map((node: DatabaseNode): string => node.label)).toEqual([
      'author_id → authors.id',
    ]);
  });

  it('expand_findsNothingUnderAPathItDidNotMint', async (): Promise<void> => {
    // An undecodable path reads as the top of the tree rather than failing.
    expect((await (await open()).expand('not a path')).map((n: DatabaseNode) => n.label)).toEqual([
      'main',
    ]);
  });

  it('expand_rejects_forASchemaThatDoesNotExist', async (): Promise<void> => {
    await expect(expand(await open(), 'nowhere')).rejects.toThrow();
  });

  it('action_scriptsSelectCreateAndInsert', async (): Promise<void> => {
    const session: EngineSession = await open();
    const books: string = encodePath('main', 'table', 'books');

    expect(await session.action(books, 'select-top')).toEqual({
      kind: 'script',
      reads: true,
      title: 'books',
      text: 'SELECT *\nFROM "books"\nLIMIT 1000;\n',
    });
    const create: NodeActionOutcome = await session.action(books, 'script-create');
    expect(create).toMatchObject({ kind: 'script', title: 'books (CREATE)' });
    expect((create as { text: string }).text).toMatch(/^CREATE TABLE books \(/);
    expect((create as { text: string }).text.endsWith(');\n')).toBe(true);
    expect(await session.action(books, 'script-insert')).toEqual({
      kind: 'script',
      title: 'books (INSERT)',
      text: 'INSERT INTO "books" ("id", "title", "author_id", "notes")\nVALUES (?, ?, ?, ?);\n',
    });
  });

  it('action_scriptsAnIndexsCreate', async (): Promise<void> => {
    expect(
      await (await open()).action(encodePath('main', 'index', 'books_by_title'), 'script-create'),
    ).toEqual({
      kind: 'script',
      title: 'books_by_title (CREATE)',
      text: 'CREATE INDEX books_by_title on books (title);\n',
    });
  });

  it('action_answersAFailure_forAnUnknownActionOrPath', async (): Promise<void> => {
    const session: EngineSession = await open();

    expect(await session.action(encodePath('main', 'table', 'books'), 'drop')).toEqual({
      kind: 'failure',
      message: "Unknown action 'drop'.",
    });
    expect(await session.action('garbage', 'select-top')).toEqual({
      kind: 'failure',
      message: 'Nothing to act on.',
    });
  });

  it('names_listsSchemasTablesViewsAndFunctions', async (): Promise<void> => {
    const session: EngineSession = await open();

    const names: readonly CompletionName[] = (await session.names?.({ kind: 'objects' })) ?? [];

    expect(names.filter((name: CompletionName): boolean => name.kind === 'schema')).toEqual([
      { name: 'main', kind: 'schema' },
    ]);
    expect(
      names.filter(
        (name: CompletionName): boolean => name.kind === 'table' || name.kind === 'view',
      ),
    ).toEqual([
      { name: 'authors', kind: 'table', detail: 'main' },
      { name: 'books', kind: 'table', detail: 'main' },
      { name: 'titles', kind: 'view', detail: 'main' },
    ]);
    const functions: readonly string[] = names
      .filter((name: CompletionName): boolean => name.kind === 'function')
      .map((name: CompletionName): string => name.name);
    expect(functions).toEqual(expect.arrayContaining(['count', 'lower', 'substr']));
    // Each once, though SQLite lists a function once per arity, and sorted.
    expect(new Set<string>(functions).size).toBe(functions.length);
    expect([...functions].sort()).toEqual(functions);
  });

  it('names_listsATablesColumns_withTheirTypes', async (): Promise<void> => {
    const session: EngineSession = await open();

    expect(await session.names?.({ kind: 'members', of: 'books' })).toEqual([
      { name: 'id', kind: 'column', detail: 'INTEGER' },
      { name: 'title', kind: 'column', detail: 'TEXT' },
      { name: 'author_id', kind: 'column', detail: 'INTEGER' },
      { name: 'notes', kind: 'column', detail: 'ANY' },
    ]);
  });

  it('names_listsTheColumnsOfASchemaQualifiedOrQuotedTable', async (): Promise<void> => {
    const session: EngineSession = await open();

    const columns: (names: readonly CompletionName[] | undefined) => readonly string[] = (
      names: readonly CompletionName[] | undefined,
    ): readonly string[] => (names ?? []).map((name: CompletionName): string => name.name);
    expect(columns(await session.names?.({ kind: 'members', of: 'main.authors' }))).toEqual([
      'id',
      'name',
    ]);
    expect(columns(await session.names?.({ kind: 'members', of: '"main"."titles"' }))).toEqual([
      'title',
    ]);
  });

  it('names_listsNoMembers_forATableThatDoesNotExist', async (): Promise<void> => {
    const session: EngineSession = await open();

    expect(await session.names?.({ kind: 'members', of: 'missing' })).toEqual([]);
  });

  it('close_closesTheDatabase', async (): Promise<void> => {
    const session: EngineSession = await new SqliteEngine('/unused/main.js').connect({ file });

    await session.close();

    await expect(session.expand(null)).rejects.toThrow();
  });
});
