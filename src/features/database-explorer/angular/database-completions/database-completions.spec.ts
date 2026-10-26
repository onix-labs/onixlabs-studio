import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import {
  CompletionName,
  DatabaseEngineInfo,
  ExecuteOutcome,
  NamesRequest,
} from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { DatabaseClient } from '../database-client/database-client';
import { DatabaseWorkspace, OpenSession } from '../database-workspace/database-workspace';
import {
  aliases,
  completionWant,
  DatabaseCompletions,
  QueryCompletion,
  quoteFor,
} from './database-completions';

/**
 * Works out what the caret wants, the caret being at the end of the text or at its `|`.
 * @param text The query, with an optional `|` marking the caret.
 * @param language The query's language.
 * @returns Returns what completionWant answers.
 */
function want(text: string, language: string = 'sql'): ReturnType<typeof completionWant> {
  const caret: number = text.indexOf('|');
  return caret < 0
    ? completionWant(text, text.length, language)
    : completionWant(text.slice(0, caret) + text.slice(caret + 1), caret, language);
}

describe('completionWant', () => {
  it('completesABareWord_withObjects', () => {
    expect(want('SELECT na')).toEqual({ kind: 'objects' });
    expect(want('')).toEqual({ kind: 'objects' });
    expect(want('SELECT * FROM ')).toEqual({ kind: 'objects' });
  });

  it('completesAfterADot_withTheMembersOfWhatItNames', () => {
    expect(want('SELECT orders.')).toEqual({ kind: 'members', of: 'orders' });
    expect(want('SELECT orders.pla')).toEqual({ kind: 'members', of: 'orders' });
    expect(want('SELECT public.orders.')).toEqual({ kind: 'members', of: 'public.orders' });
  });

  it('resolvesAnAlias_toTheTableItStandsFor', () => {
    expect(want('SELECT * FROM orders o WHERE o.')).toEqual({ kind: 'members', of: 'orders' });
    expect(
      want('SELECT c.| FROM orders o JOIN public.customers AS c ON c.id = o.customer'),
    ).toEqual({ kind: 'members', of: 'public.customers' });
  });

  it('resolvesAQuotedNameOrAlias', () => {
    expect(want('SELECT * FROM "Orders" WHERE "Orders".')).toEqual({
      kind: 'members',
      of: '"Orders"',
    });
    expect(want('SELECT * FROM `orders` AS o WHERE o.', 'sql')).toEqual({
      kind: 'members',
      of: '`orders`',
    });
  });

  it('doesNotTakeAKeywordAfterTheTable_forAnAlias', () => {
    expect(want('SELECT * FROM orders WHERE x.')).toEqual({ kind: 'members', of: 'x' });
    expect(want('SELECT * FROM orders WHERE orders.')).toEqual({ kind: 'members', of: 'orders' });
  });

  it('completesNothing_insideAStringLiteral', () => {
    expect(want("SELECT * FROM orders WHERE note = 'o.")).toBeNull();
    expect(want("SELECT 'it''s o.")).toBeNull();
    expect(want("SELECT '")).toBeNull();
  });

  it('completesNothing_insideAComment', () => {
    expect(want('SELECT 1 -- see o.')).toBeNull();
    expect(want('SELECT /* o.')).toBeNull();
    expect(want('SELECT /* a\nb o.')).toBeNull();
  });

  it('completes_afterAClosedStringOrComment', () => {
    expect(want("SELECT * FROM orders o WHERE o.note = 'x' AND o.")).toEqual({
      kind: 'members',
      of: 'orders',
    });
    expect(want("SELECT 'it''s'")).toEqual({ kind: 'objects' });
    expect(want('SELECT /* note */ o.| FROM orders o')).toEqual({ kind: 'members', of: 'orders' });
    expect(want('-- heading\nSELECT ')).toEqual({ kind: 'objects' });
  });

  it('ignoresATableNamedInsideAStringOrComment', () => {
    expect(want("SELECT 'from ledger l' AS x, l.")).toEqual({ kind: 'members', of: 'l' });
    expect(want('SELECT l.| /* FROM ledger l */')).toEqual({ kind: 'members', of: 'l' });
  });

  it('completesALabel_afterAColonInANodePattern', () => {
    expect(want('MATCH (m:', 'cypher')).toEqual({ kind: 'labels' });
    expect(want('MATCH (m:Mov', 'cypher')).toEqual({ kind: 'labels' });
    expect(want('MATCH (:', 'cypher')).toEqual({ kind: 'labels' });
    expect(want('MATCH (m:Person:', 'cypher')).toEqual({ kind: 'labels' });
  });

  it('completesARelationshipType_afterAColonOrABarInARelationshipPattern', () => {
    expect(want('MATCH (a)-[r:', 'cypher')).toEqual({ kind: 'relationships' });
    expect(want('MATCH (a)-[r:ACT', 'cypher')).toEqual({ kind: 'relationships' });
    expect(want('MATCH (a)-[r:A|', 'cypher')).toEqual({ kind: 'relationships' });
    expect(want('MATCH (a)-[:ACTED_IN|DIR', 'cypher')).toEqual({ kind: 'relationships' });
  });

  it('completesAVariablesProperties_withTheMembersOfItsLabel', () => {
    expect(want('MATCH (m:Movie) RETURN m.', 'cypher')).toEqual({ kind: 'members', of: 'Movie' });
    expect(want('MATCH (a)-[r:ACTED_IN]->(b) RETURN r.ro', 'cypher')).toEqual({
      kind: 'members',
      of: 'ACTED_IN',
    });
    expect(want('MATCH (m) RETURN m.', 'cypher')).toEqual({ kind: 'members', of: 'm' });
  });

  it('completesObjects_inCypherOutsideAPattern', () => {
    expect(want('MATCH (m) RETURN ', 'cypher')).toEqual({ kind: 'objects' });
  });

  it('doesNotOfferLabels_inSql', () => {
    expect(want('SELECT (a:')).toEqual({ kind: 'objects' });
  });
});

describe('aliases', () => {
  it('mapsEachTableAndAlias_toTheTable_inLowerCase', () => {
    expect(
      aliases(
        'SELECT * FROM orders o JOIN public.customers AS C ON 1=1 JOIN items WHERE 1=1',
        'sql',
      ),
    ).toEqual(
      new Map<string, string>([
        ['orders', 'orders'],
        ['o', 'orders'],
        ['customers', 'public.customers'],
        ['c', 'public.customers'],
        ['items', 'items'],
      ]),
    );
  });

  it('readsTheTablesOfUpdatesAndInserts', () => {
    expect([...aliases('UPDATE orders SET x = 1', 'sql').entries()]).toEqual([
      ['orders', 'orders'],
    ]);
    expect([...aliases('INSERT INTO lines l VALUES (1)', 'sql').entries()]).toEqual([
      ['lines', 'lines'],
      ['l', 'lines'],
    ]);
  });

  it('keysAQuotedTableByItsUnquotedName', () => {
    expect([...aliases('SELECT * FROM "public"."Orders" o', 'sql').entries()]).toEqual([
      ['orders', '"public"."Orders"'],
      ['o', '"public"."Orders"'],
    ]);
  });

  it('keepsTheSpacesInsideAQuotedTableName', () => {
    expect(aliases('SELECT * FROM "Order Lines" ol', 'sql').get('ol')).toBe('"Order Lines"');
  });

  it('readsAJoinedTable_whenTheTableBeforeItHasNoAlias', () => {
    expect(aliases('SELECT * FROM orders JOIN items i ON 1=1', 'sql').get('i')).toBe('items');
  });

  it('mapsCypherVariables_toTheirLabelOrType', () => {
    expect(aliases('MATCH (m:Movie)<-[r:ACTED_IN]-(P:`Some One`) RETURN m', 'cypher')).toEqual(
      new Map<string, string>([
        ['m', 'Movie'],
        ['r', 'ACTED_IN'],
        ['p', '`Some One`'],
      ]),
    );
  });

  it('ignoresTablesInStringsAndComments', () => {
    expect(aliases("SELECT 'from x' -- join y\nFROM z", 'sql')).toEqual(
      new Map<string, string>([['z', 'z']]),
    );
  });
});

describe('quoteFor', () => {
  it('leavesAPostgresNameUnquoted_onlyWhenItIsLowerCase', () => {
    expect(quoteFor('orders', 'pgsql')).toBe('orders');
    expect(quoteFor('order_lines2$', 'pgsql')).toBe('order_lines2$');
    expect(quoteFor('Orders', 'pgsql')).toBe('"Orders"');
    expect(quoteFor('order lines', 'pgsql')).toBe('"order lines"');
    expect(quoteFor('2fa', 'pgsql')).toBe('"2fa"');
  });

  it('leavesAnSqlNameUnquoted_whenItIsAPlainIdentifier_inAnyCase', () => {
    expect(quoteFor('Orders', 'sql')).toBe('Orders');
    expect(quoteFor('café', 'sql')).toBe('café');
    expect(quoteFor('order lines', 'sql')).toBe('"order lines"');
  });

  it('quotesCypherInBackticks', () => {
    expect(quoteFor('Movie', 'cypher')).toBe('Movie');
    expect(quoteFor('Some One', 'cypher')).toBe('`Some One`');
  });

  it('doublesAnEmbeddedQuote', () => {
    expect(quoteFor('say "hi"', 'pgsql')).toBe('"say ""hi"""');
    expect(quoteFor('say "hi"', 'sql')).toBe('"say ""hi"""');
    expect(quoteFor('a`b', 'cypher')).toBe('`a``b`');
  });
});

/**
 * An engine that completes.
 */
const POSTGRES: DatabaseEngineInfo = {
  id: 'postgres',
  displayName: 'PostgreSQL',
  language: 'pgsql',
  queryExtension: 'sql',
  capabilities: ['cancel', 'multipleDatabases', 'script', 'completion'],
  connectionFields: [],
};

/**
 * A graph engine that completes.
 */
const NEO4J: DatabaseEngineInfo = {
  id: 'neo4j',
  displayName: 'Neo4j',
  language: 'cypher',
  queryExtension: 'cypher',
  capabilities: ['graph', 'completion'],
  connectionFields: [],
};

/**
 * An engine that does not complete.
 */
const PLAIN: DatabaseEngineInfo = {
  id: 'plain',
  displayName: 'Plain',
  language: 'sql',
  queryExtension: 'sql',
  capabilities: ['script'],
  connectionFields: [],
};

/**
 * The objects the fake engine names.
 */
const OBJECTS: readonly CompletionName[] = [
  { name: 'public', kind: 'schema' },
  { name: 'sales', kind: 'schema' },
  { name: 'orders', kind: 'table', detail: 'public' },
  { name: 'Customers', kind: 'table', detail: 'public' },
  { name: 'totals', kind: 'view', detail: 'sales' },
  { name: 'count', kind: 'function' },
];

/**
 * The members the fake engine names, by the object as the request names it.
 */
const MEMBERS: Readonly<Record<string, readonly CompletionName[]>> = {
  orders: [
    { name: 'id', kind: 'column', detail: 'integer' },
    { name: 'placed', kind: 'column', detail: 'date' },
  ],
  'public.Customers': [
    { name: 'id', kind: 'column', detail: 'integer' },
    { name: 'Full Name', kind: 'column', detail: 'text' },
  ],
  Movie: [{ name: 'title', kind: 'property' }],
};

/**
 * A stand-in for the engine client, recording each request for names.
 */
class FakeClient {
  /**
   * Holds every request.
   */
  public readonly requests: NamesRequest[] = [];

  /**
   * Holds the objects answered.
   */
  public objects: readonly CompletionName[] = OBJECTS;

  /**
   * Answers a request for names.
   * @param request The request.
   * @returns Returns the names.
   */
  public names(request: NamesRequest): Promise<readonly CompletionName[]> {
    this.requests.push(request);
    return Promise.resolve(
      request.scope.kind === 'objects' ? this.objects : (MEMBERS[request.scope.of] ?? []),
    );
  }

  /**
   * Describes the requests, one string each.
   * @returns Returns them.
   */
  public asked(): readonly string[] {
    return this.requests.map((request: NamesRequest): string =>
      request.scope.kind === 'objects' ? 'objects' : `members:${request.scope.of}`,
    );
  }
}

/**
 * A stand-in for the workspace, holding just what completions read.
 */
class FakeWorkspace {
  public readonly queryList: DatabaseQuery[] = [];
  public readonly connectionList: DatabaseConnection[] = [];
  public readonly engineList: DatabaseEngineInfo[] = [POSTGRES, NEO4J, PLAIN];
  public readonly sessions: WritableSignal<ReadonlyMap<string, OpenSession>> = signal<
    ReadonlyMap<string, OpenSession>
  >(new Map<string, OpenSession>());
  public readonly outcomes: WritableSignal<ReadonlyMap<string, ExecuteOutcome>> = signal<
    ReadonlyMap<string, ExecuteOutcome>
  >(new Map<string, ExecuteOutcome>());

  /**
   * Finds a query.
   * @param id The id.
   * @returns Returns the query.
   */
  public query(id: string): DatabaseQuery | undefined {
    return this.queryList.find((query: DatabaseQuery): boolean => query.id === id);
  }

  /**
   * Finds a connection.
   * @param id The id.
   * @returns Returns the connection.
   */
  public connection(id: string | null): DatabaseConnection | undefined {
    return this.connectionList.find(
      (connection: DatabaseConnection): boolean => connection.id === id,
    );
  }

  /**
   * Finds an engine.
   * @param id The id.
   * @returns Returns the engine.
   */
  public engine(id: string): DatabaseEngineInfo | undefined {
    return this.engineList.find((engine: DatabaseEngineInfo): boolean => engine.id === id);
  }

  /**
   * Adds a connection and a query against it, optionally with a session open.
   * @param engine The engine's id.
   * @param open Whether its session is open.
   * @param database The query's database.
   * @returns Returns the query's id.
   */
  public add(engine: string, open: boolean = true, database?: string): string {
    const index: number = this.queryList.length + 1;
    this.connectionList.push({ id: `c${index}`, name: `C${index}`, engine, values: {} });
    this.queryList.push({
      id: `q${index}`,
      title: `Q${index}`,
      connectionId: `c${index}`,
      ...(database === undefined ? {} : { database }),
      text: '',
    });
    if (open) {
      this.open(`c${index}`, `s${index}`);
    }
    return `q${index}`;
  }

  /**
   * Opens a session for a connection.
   * @param connection The connection's id.
   * @param session The session's id.
   */
  public open(connection: string, session: string): void {
    this.sessions.update(
      (sessions: ReadonlyMap<string, OpenSession>): ReadonlyMap<string, OpenSession> =>
        new Map<string, OpenSession>([...sessions, [connection, { session, serverVersion: 'X' }]]),
    );
  }
}

describe('DatabaseCompletions', () => {
  let client: FakeClient;
  let workspace: FakeWorkspace;
  let completions: DatabaseCompletions;

  beforeEach(() => {
    client = new FakeClient();
    workspace = new FakeWorkspace();
    TestBed.configureTestingModule({
      providers: [
        DatabaseCompletions,
        { provide: DatabaseWorkspace, useValue: workspace },
        { provide: DatabaseClient, useValue: client },
      ],
    });
    completions = TestBed.inject(DatabaseCompletions);
    TestBed.tick();
  });

  /**
   * Completes a query at its end, or at its `|`.
   * @param id The query's id.
   * @param text The query, with an optional `|` marking the caret.
   * @returns Returns the completions.
   */
  function complete(id: string, text: string): Promise<readonly QueryCompletion[]> {
    const caret: number = text.indexOf('|');
    return caret < 0
      ? completions.complete(id, text, text.length)
      : completions.complete(id, text.slice(0, caret) + text.slice(caret + 1), caret);
  }

  /**
   * Gets the labels of completions.
   * @param items The completions.
   * @returns Returns their labels.
   */
  function labels(items: readonly QueryCompletion[]): readonly string[] {
    return items.map((item: QueryCompletion): string => item.label);
  }

  it('complete_answersNone_forAQueryWithNoOpenSession', async () => {
    const id: string = workspace.add('postgres', false);

    expect(await complete(id, 'SELECT ')).toEqual([]);
    expect(await complete('missing', 'SELECT ')).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it('complete_answersNone_forAnEngineWithoutCompletion', async () => {
    const id: string = workspace.add('plain');

    expect(await complete(id, 'SELECT ')).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it('complete_answersNone_insideACommentOrString', async () => {
    const id: string = workspace.add('postgres');

    expect(await complete(id, "SELECT 'x")).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it('complete_offersTheObjects_quotedForTheLanguage_withTheirKindAndDetail', async () => {
    const id: string = workspace.add('postgres');

    const items: readonly QueryCompletion[] = await complete(id, 'SELECT ');

    expect(items).toEqual([
      { label: 'public', kind: 'schema', insertText: 'public' },
      { label: 'sales', kind: 'schema', insertText: 'sales' },
      { label: 'orders', kind: 'table', detail: 'public', insertText: 'orders' },
      { label: 'Customers', kind: 'table', detail: 'public', insertText: '"Customers"' },
      { label: 'totals', kind: 'view', detail: 'sales', insertText: 'totals' },
      { label: 'count', kind: 'function', insertText: 'count' },
    ]);
    expect(client.requests).toEqual([{ session: 's1', scope: { kind: 'objects' } }]);
  });

  it('complete_asksForTheObjectsOnce_andNamesTheQuerysDatabase', async () => {
    const id: string = workspace.add('postgres', true, 'shop');

    await complete(id, 'SELECT ');
    await complete(id, 'SELECT o');

    expect(client.requests).toEqual([
      { session: 's1', database: 'shop', scope: { kind: 'objects' } },
    ]);
  });

  it('complete_cachesBySessionAndDatabase', async () => {
    const shop: string = workspace.add('postgres', true, 'shop');
    const reports: string = workspace.add('postgres', true, 'reports');

    await complete(shop, 'SELECT ');
    await complete(reports, 'SELECT ');

    expect(
      client.requests.map(
        (request: NamesRequest): string => `${request.session}/${request.database}`,
      ),
    ).toEqual(['s1/shop', 's2/reports']);
  });

  it('complete_offersAReferencedTablesColumnsFirst_forABareWord', async () => {
    const id: string = workspace.add('postgres');

    const items: readonly QueryCompletion[] = await complete(
      id,
      'SELECT | FROM orders o JOIN public.Customers c ON c.id = o.id',
    );

    expect(labels(items)).toEqual([
      'id',
      'placed',
      'Full Name',
      ...OBJECTS.map((name: CompletionName): string => name.name),
    ]);
    expect(items[2]).toEqual({
      label: 'Full Name',
      kind: 'column',
      detail: 'text',
      insertText: '"Full Name"',
    });
    expect(client.asked()).toEqual(['objects', 'members:orders', 'members:public.Customers']);
  });

  it('complete_asksOnlyForTheMembersOfTablesTheQueryNames_andCachesThem', async () => {
    const id: string = workspace.add('postgres');

    expect(labels(await complete(id, 'SELECT o.| FROM orders o'))).toEqual(['id', 'placed']);
    expect(labels(await complete(id, 'SELECT o.p| FROM orders o'))).toEqual(['id', 'placed']);
    await complete(id, 'SELECT | FROM orders o');

    expect(client.asked()).toEqual(['members:orders', 'objects']);
  });

  it('complete_offersASchemasObjects_afterASchemaWithNoMembers', async () => {
    const id: string = workspace.add('postgres');

    const items: readonly QueryCompletion[] = await complete(id, 'SELECT * FROM public.');

    expect(labels(items)).toEqual(['orders', 'Customers']);
    expect(labels(await complete(id, 'SELECT * FROM sales.'))).toEqual(['totals']);
    expect(client.asked()).toEqual(['members:public', 'objects', 'members:sales']);
  });

  it('complete_offersALabelsKeys_andNoFallback_inCypher', async () => {
    client.objects = [
      { name: 'Movie', kind: 'label' },
      { name: 'Person', kind: 'label' },
      { name: 'ACTED_IN', kind: 'relationship' },
      { name: 'title', kind: 'property' },
    ];
    const id: string = workspace.add('neo4j');

    expect(labels(await complete(id, 'MATCH (m:Movie) RETURN m.'))).toEqual(['title']);
    expect(labels(await complete(id, 'MATCH (p:Person) RETURN p.'))).toEqual([]);
    expect(labels(await complete(id, 'MATCH (m:'))).toEqual(['Movie', 'Person']);
    expect(labels(await complete(id, 'MATCH (m)-[r:'))).toEqual(['ACTED_IN']);
    // A bare word in Cypher is every name, with no referenced tables to look up.
    expect(labels(await complete(id, 'MATCH (m:Movie) RETURN '))).toEqual([
      'Movie',
      'Person',
      'ACTED_IN',
      'title',
    ]);
    expect(client.asked()).toEqual(['members:Movie', 'members:Person', 'objects']);
  });

  it('complete_dropsTheCache_whenAnOutcomeLands', async () => {
    const id: string = workspace.add('postgres');
    await complete(id, 'SELECT ');

    workspace.outcomes.set(new Map<string, ExecuteOutcome>());
    TestBed.tick();
    await complete(id, 'SELECT ');

    expect(client.asked()).toEqual(['objects', 'objects']);
  });

  it('complete_dropsTheCache_whenTheSessionsChange', async () => {
    const id: string = workspace.add('postgres');
    await complete(id, 'SELECT o.| FROM orders o');

    workspace.open('c9', 's9');
    TestBed.tick();
    await complete(id, 'SELECT o.| FROM orders o');

    expect(client.asked()).toEqual(['members:orders', 'members:orders']);
  });

  it('complete_offersEachNameOnce_perKind', async () => {
    client.objects = [
      { name: 'orders', kind: 'table', detail: 'public' },
      { name: 'orders', kind: 'table', detail: 'public' },
      { name: 'id', kind: 'function' },
    ];
    const id: string = workspace.add('postgres');

    const items: readonly QueryCompletion[] = await complete(
      id,
      'SELECT | FROM orders o JOIN public.Customers c',
    );

    // `id` is a column of both tables, offered once; the function of that name is a different thing.
    expect(items.map((item: QueryCompletion): string => `${item.kind}:${item.label}`)).toEqual([
      'column:id',
      'column:placed',
      'column:Full Name',
      'table:orders',
      'function:id',
    ]);
  });
});
