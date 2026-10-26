/**
 * The plugin runs under plain Node, and so does this spec. The driver's own value types are real; only
 * `neo4j.driver` is replaced by a fake, so no server is ever reached.
 * @vitest-environment node
 */
import neo4j, {
  Date as Neo4jDate,
  DateTime,
  Duration,
  EagerResult,
  Integer,
  LocalDateTime,
  LocalTime,
  Node,
  Path,
  PathSegment,
  Point,
  QueryResult,
  Record as Neo4jRecord,
  Relationship,
  ResultSummary,
  Time,
} from 'neo4j-driver';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import {
  DatabaseNode,
  GraphNodeValue,
  GraphRelationshipValue,
} from '../../protocol/database/protocol';
import {
  encodePath,
  EngineExecution,
  EngineSession,
  MAX_RESULT_ROWS,
} from '../../protocol/database/engine';
import {
  describeSummary,
  Neo4jEngine,
  nodeValue,
  relationshipValue,
  toValue,
} from './neo4j-engine';

/**
 * A stand-in for a Bolt session.
 */
interface FakeSession {
  readonly run: Mock<(text: string) => Running>;
  readonly close: Mock<() => Promise<void>>;
}

/**
 * What a Bolt session's `run` hands back: the result, which can also be asked for its keys before its
 * records arrive.
 */
type Running = Promise<QueryResult> & { keys(): Promise<string[]> };

/**
 * Makes an answer look like a running result, as the driver's is.
 * @param answer The eventual result.
 * @returns Returns the running result.
 */
function asRunning(answer: Promise<QueryResult>): Running {
  return Object.assign(answer, {
    keys: (): Promise<string[]> =>
      answer.then((done: QueryResult): string[] => [...(done as EagerResult).keys]),
  });
}

/**
 * A stand-in for the driver.
 */
interface FakeDriver {
  readonly getServerInfo: Mock<() => Promise<{ agent?: string }>>;
  readonly executeQuery: Mock<
    (query: string, parameters: object, config: { database?: string }) => Promise<QueryResult>
  >;
  readonly session: Mock<(config: { database?: string }) => FakeSession>;
  readonly close: Mock<() => Promise<void>>;
}

/**
 * The state the fake driver factory shares with the tests.
 */
interface Neo4jMock {
  readonly driver: Mock<(uri: string, auth: unknown, config: unknown) => FakeDriver>;
}

const neo4jMock: Neo4jMock = vi.hoisted((): Neo4jMock => ({
  driver: vi.fn<(uri: string, auth: unknown, config: unknown) => FakeDriver>(),
}));

vi.mock(
  'neo4j-driver',
  async (
    importOriginal: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> => {
    const actual: Record<string, unknown> = await importOriginal();
    return {
      ...actual,
      default: { ...(actual['default'] as Record<string, unknown>), driver: neo4jMock.driver },
    };
  },
);

/**
 * Builds a query result as the driver would.
 * @param keys The columns.
 * @param rows The rows.
 * @param metadata The summary's metadata: stats, notifications.
 * @returns Returns the result.
 */
function result(
  keys: string[],
  rows: unknown[][],
  metadata: Record<string, unknown> = {},
): QueryResult {
  return new EagerResult(
    keys,
    rows.map((row: unknown[]): Neo4jRecord => new Neo4jRecord(keys, row)),
    new ResultSummary('query', {}, metadata),
  );
}

/**
 * Builds a node with an element id.
 * @param id The element id.
 * @param labels The labels.
 * @param properties The properties.
 * @returns Returns the node.
 */
function node(id: string, labels: string[], properties: Record<string, unknown> = {}): Node {
  return new Node(neo4j.int(Number(id.split(':').at(-1))), labels, properties, id);
}

/**
 * Builds a relationship with element ids.
 * @param id The element id.
 * @param type The type.
 * @param start The start node.
 * @param end The end node.
 * @param properties The properties.
 * @returns Returns the relationship.
 */
function relationship(
  id: string,
  type: string,
  start: Node,
  end: Node,
  properties: Record<string, unknown> = {},
): Relationship {
  return new Relationship(
    neo4j.int(100),
    start.identity,
    end.identity,
    type,
    properties,
    id,
    start.elementId,
    end.elementId,
  );
}

describe('toValue', (): void => {
  it('turnsAVector_intoAListOfItsNumbers', (): void => {
    expect(toValue(neo4j.vector(Float32Array.from([1, 2.5])))).toEqual({
      type: 'list',
      items: [1, 2.5],
    });
    expect(toValue(neo4j.vector(BigInt64Array.from([9007199254740993n])))).toEqual({
      type: 'list',
      items: [{ type: 'bigint', value: '9007199254740993' }],
    });
  });

  it('turnsATypedArrayOtherThanBytes_intoAList', (): void => {
    expect(toValue(Float64Array.from([0.5, 1.5]))).toEqual({ type: 'list', items: [0.5, 1.5] });
    expect(toValue(Int32Array.from([-1, 7]))).toEqual({ type: 'list', items: [-1, 7] });
  });

  it('turnsAUuid_intoItsText', (): void => {
    const id: string = '0b7f4c1e-5b2a-4a8e-9d3c-2f1e6a7b8c9d';

    expect(toValue(neo4j.uuid(id))).toBe(id);
  });

  it('readsNullAndUndefinedAsNull', (): void => {
    expect(toValue(null)).toBeNull();
    expect(toValue(undefined)).toBeNull();
  });

  it('readsAnIntegerAsANumber_whenItIsSafe_andAsDigitsOtherwise', (): void => {
    expect(toValue(neo4j.int(42))).toBe(42);
    expect(toValue(neo4j.int('-9007199254740991'))).toBe(-9007199254740991);
    expect(toValue(neo4j.int('9007199254740993'))).toEqual({
      type: 'bigint',
      value: '9007199254740993',
    });
    expect(toValue(Integer.MIN_VALUE)).toEqual({ type: 'bigint', value: '-9223372036854775808' });
  });

  it('passesStringsNumbersAndBooleansThrough_andReadsABigintAsDigits', (): void => {
    expect(toValue('Ada')).toBe('Ada');
    expect(toValue(1.5)).toBe(1.5);
    expect(toValue(false)).toBe(false);
    expect(toValue(5n)).toEqual({ type: 'bigint', value: '5' });
  });

  it('readsANodeAndARelationshipAsGraphValues', (): void => {
    const ada: Node = node('4:db:1', ['Person'], { name: 'Ada' });
    const lab: Node = node('4:db:2', ['Place']);

    expect(toValue(ada)).toEqual({
      type: 'node',
      id: '4:db:1',
      labels: ['Person'],
      properties: { name: 'Ada' },
    });
    expect(toValue(relationship('5:db:9', 'WORKS_AT', ada, lab))).toEqual({
      type: 'relationship',
      id: '5:db:9',
      relationshipType: 'WORKS_AT',
      start: '4:db:1',
      end: '4:db:2',
      properties: {},
    });
  });

  it('readsAPathAsItsNodesAndRelationshipsInOrder', (): void => {
    const a: Node = node('4:db:1', ['A']);
    const b: Node = node('4:db:2', ['B']);
    const c: Node = node('4:db:3', ['C']);
    const ab: Relationship = relationship('5:db:1', 'TO', a, b);
    const bc: Relationship = relationship('5:db:2', 'TO', b, c);

    const value: unknown = toValue(
      new Path(a, c, [new PathSegment(a, ab, b), new PathSegment(b, bc, c)]),
    );

    expect(value).toEqual({
      type: 'path',
      nodes: [nodeValue(a), nodeValue(b), nodeValue(c)],
      relationships: [relationshipValue(ab), relationshipValue(bc)],
    });
  });

  it('readsAPathOfNoSegmentsAsItsOneNode', (): void => {
    const a: Node = node('4:db:1', ['A']);

    expect(toValue(new Path(a, a, []))).toEqual({
      type: 'path',
      nodes: [nodeValue(a)],
      relationships: [],
    });
  });

  it('readsEveryTemporalAndSpatialTypeAsItsText', (): void => {
    const values: readonly [unknown, string][] = [
      [new Neo4jDate(2026, 10, 26), '2026-10-26'],
      [new LocalTime(12, 34, 56, 123456789), '12:34:56.123456789'],
      [new Time(12, 34, 56, 0, 3600), '12:34:56+01:00'],
      [new LocalDateTime(2026, 10, 26, 12, 0, 0, 0), '2026-10-26T12:00:00'],
      [
        new DateTime(2026, 10, 26, 12, 0, 0, 0, undefined, 'Europe/London'),
        '2026-10-26T12:00:00[Europe/London]',
      ],
      [new Duration(1, 2, 3, 4), 'P1M2DT3.000000004S'],
    ];

    for (const [value, expected] of values) {
      expect(toValue(value)).toEqual({ type: 'temporal', value: expected });
    }
    expect(toValue(new Point(7203, 1, 2))).toEqual({
      type: 'temporal',
      value: String(new Point(7203, 1, 2)),
    });
  });

  it('describesBytesByTheirSizeAndAHexPreview_includingAViewIntoALargerBuffer', (): void => {
    expect(toValue(new Uint8Array([1, 2, 255]))).toEqual({
      type: 'bytes',
      size: 3,
      preview: '0102ff',
    });
    const backing: Uint8Array = new Uint8Array([9, 9, 0xab, 0xcd, 9]);
    expect(toValue(new Int8Array(backing.buffer, 2, 2))).toEqual({
      type: 'bytes',
      size: 2,
      preview: 'abcd',
    });
  });

  it('readsAListAndAMap_convertingWhatTheyHold', (): void => {
    expect(toValue([neo4j.int(1), 'two', null])).toEqual({
      type: 'list',
      items: [1, 'two', null],
    });
    expect(toValue({ age: neo4j.int(36), tags: ['a'] })).toEqual({
      type: 'map',
      entries: { age: 36, tags: { type: 'list', items: ['a'] } },
    });
  });
});

describe('nodeValue and relationshipValue', (): void => {
  it('convertTheirProperties', (): void => {
    const a: Node = node('4:db:1', ['Person', 'Engineer'], {
      born: new Neo4jDate(1815, 12, 10),
      id: neo4j.int(1),
    });
    const b: Node = node('4:db:2', ['Person']);

    const value: GraphNodeValue = nodeValue(a);
    const link: GraphRelationshipValue = relationshipValue(
      relationship('5:db:1', 'KNOWS', a, b, { since: neo4j.int(1833) }),
    );

    expect(value).toEqual({
      type: 'node',
      id: '4:db:1',
      labels: ['Person', 'Engineer'],
      properties: { born: { type: 'temporal', value: '1815-12-10' }, id: 1 },
    });
    // The labels are a copy, not the driver's own array.
    expect(value.labels).not.toBe(a.labels);
    expect(link.properties).toEqual({ since: 1833 });
  });
});

describe('describeSummary', (): void => {
  it('countsTheRowsReturned', (): void => {
    expect(describeSummary(result(['n'], []))).toBe('0 rows returned');
    expect(describeSummary(result(['n'], [[1]]))).toBe('1 row returned');
    expect(describeSummary(result(['n'], [[1], [2]]))).toBe('2 rows returned');
  });

  it('namesTheChangesItMade_beforeTheRows', (): void => {
    expect(
      describeSummary(
        result(['n'], [[1]], {
          stats: { 'nodes-created': 2, 'properties-set': 4, 'relationships-created': 1 },
        }),
      ),
    ).toBe('2 nodes created, 1 relationships created, 4 properties set; 1 row returned');
  });
});

describe('Neo4jEngine', (): void => {
  let driver: FakeDriver;
  let sessions: FakeSession[];
  let opened: EngineSession[];

  beforeEach((): void => {
    sessions = [];
    opened = [];
    driver = {
      getServerInfo: vi.fn((): Promise<{ agent?: string }> =>
        Promise.resolve({ agent: 'Neo4j/5.26.0' }),
      ),
      executeQuery: vi.fn((query: string): Promise<QueryResult> =>
        Promise.reject(new Error(`Unexpected: ${query}`)),
      ),
      session: vi.fn((): FakeSession => {
        const session: FakeSession = {
          run: vi.fn((): Running => asRunning(Promise.resolve(result([], [])))),
          close: vi.fn((): Promise<void> => Promise.resolve()),
        };
        sessions.push(session);
        return session;
      }),
      close: vi.fn((): Promise<void> => Promise.resolve()),
    };
    neo4jMock.driver.mockReset();
    neo4jMock.driver.mockImplementation((): FakeDriver => driver);
  });

  afterEach(async (): Promise<void> => {
    for (const session of opened) {
      await session.close();
    }
  });

  /**
   * Connects with the given values.
   * @param values The connection's field values.
   * @returns Returns the session.
   */
  async function open(values: Record<string, string> = {}): Promise<EngineSession> {
    const session: EngineSession = await new Neo4jEngine().connect({
      uri: 'neo4j://graph.example:7687',
      user: 'neo4j',
      password: 'secret',
      ...values,
    });
    opened.push(session);
    return session;
  }

  /**
   * Makes the next Bolt session answer each statement with the responder.
   * @param respond Answers a statement.
   */
  function answer(respond: (text: string) => Promise<QueryResult> | QueryResult): void {
    driver.session.mockImplementationOnce((): FakeSession => {
      const session: FakeSession = {
        run: vi.fn((text: string): Running =>
          asRunning(Promise.resolve().then(() => respond(text))),
        ),
        close: vi.fn((): Promise<void> => Promise.resolve()),
      };
      sessions.push(session);
      return session;
    });
  }

  /**
   * Runs a script.
   * @param session The session.
   * @param script The script.
   * @param firstLine The line it starts on.
   * @param id The execution's identifier.
   * @returns Returns what it produced.
   */
  function run(
    session: EngineSession,
    script: string,
    firstLine: number = 1,
    id: string = 'run-1',
  ): Promise<EngineExecution> {
    return session.execute({ id, session: 's1', text: script, firstLine });
  }

  it('info_describesCypherAndTheGraphCapability', (): void => {
    const engine: Neo4jEngine = new Neo4jEngine();

    expect(engine.info).toMatchObject({
      id: 'neo4j',
      displayName: 'Neo4j',
      language: 'cypher',
      queryExtension: 'cypher',
    });
    expect(engine.info.capabilities).toContain('graph');
    expect(engine.info.capabilities).toEqual(['cancel', 'multipleDatabases', 'script', 'graph']);
    expect(engine.info.connectionFields.map((field: { id: string }): string => field.id)).toEqual([
      'uri',
      'database',
      'user',
      'password',
    ]);
    expect(engine.info.connectionFields[3]).toMatchObject({ kind: 'password', secret: true });
  });

  it('connect_refusesAnEmptyAddress_withoutOpeningADriver', async (): Promise<void> => {
    await expect(new Neo4jEngine().connect({ uri: '   ' })).rejects.toThrow(
      'Enter the server address.',
    );
    expect(neo4jMock.driver).not.toHaveBeenCalled();
  });

  it('connect_opensADriverWithBasicAuth_andReportsTheServerAgent', async (): Promise<void> => {
    const session: EngineSession = await open({
      uri: ' neo4j://graph.example:7687 ',
      user: ' bob ',
    });

    expect(neo4jMock.driver).toHaveBeenCalledWith(
      'neo4j://graph.example:7687',
      neo4j.auth.basic('bob', 'secret'),
      { connectionTimeout: 10_000, disableLosslessIntegers: false },
    );
    expect(session.serverVersion).toBe('Neo4j/5.26.0');
  });

  it('connect_callsTheServerNeo4j_whenItGivesNoAgent', async (): Promise<void> => {
    driver.getServerInfo.mockResolvedValueOnce({});

    expect((await open()).serverVersion).toBe('Neo4j');
  });

  it('connect_closesTheDriverAndRejectsWithItsMessage_whenTheServerCannotBeReached', async (): Promise<void> => {
    const cause: Error = new Error('Could not perform discovery. No routing servers available.');
    driver.getServerInfo.mockRejectedValueOnce(cause);

    const failure: Promise<EngineSession> = new Neo4jEngine().connect({ uri: 'neo4j://nowhere' });

    await expect(failure).rejects.toThrow(
      'Could not perform discovery. No routing servers available.',
    );
    await expect(failure).rejects.toMatchObject({ cause });
    expect(driver.close).toHaveBeenCalledTimes(1);
  });

  it('expand_listsTheDatabases_fromTheSystemDatabase', async (): Promise<void> => {
    driver.executeQuery.mockResolvedValueOnce(
      result(
        ['name', 'currentStatus', 'home'],
        [
          ['movies', 'online', false],
          ['neo4j', 'online', true],
          ['old', 'offline', false],
        ],
      ),
    );

    const nodes: readonly DatabaseNode[] = await (await open()).expand(null);

    expect(driver.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('SHOW DATABASES'),
      {},
      {
        database: 'system',
      },
    );
    expect(
      nodes.map((entry: DatabaseNode): [string, string, string | undefined] => [
        entry.path,
        entry.label,
        entry.detail,
      ]),
    ).toEqual([
      [encodePath('db', 'movies'), 'movies', undefined],
      [encodePath('db', 'neo4j'), 'neo4j', 'home'],
      [encodePath('db', 'old'), 'old', 'offline'],
    ]);
    expect(nodes[0]).toMatchObject({
      icon: 'database',
      leaf: false,
      database: 'movies',
      actions: [{ id: 'schema', label: 'Show Schema Graph' }],
    });
  });

  it('expand_fallsBackToTheConnectionsDatabase_whenTheServerWillNotListThem', async (): Promise<void> => {
    driver.executeQuery.mockRejectedValueOnce(new Error('Unsupported administration command'));

    const nodes: readonly DatabaseNode[] = await (await open({ database: 'movies' })).expand(null);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: 'movies', detail: 'home', database: 'movies' });
  });

  it('expand_givesADatabaseItsSchemaFolders', async (): Promise<void> => {
    const nodes: readonly DatabaseNode[] = await (await open()).expand(encodePath('db', 'movies'));

    expect(nodes.map((entry: DatabaseNode): [string, string] => [entry.path, entry.label])).toEqual(
      [
        [encodePath('db', 'movies', 'labels'), 'Node Labels'],
        [encodePath('db', 'movies', 'types'), 'Relationship Types'],
        [encodePath('db', 'movies', 'keys'), 'Property Keys'],
        [encodePath('db', 'movies', 'indexes'), 'Indexes'],
        [encodePath('db', 'movies', 'constraints'), 'Constraints'],
      ],
    );
    expect(driver.executeQuery).not.toHaveBeenCalled();
  });

  it('expand_listsLabelsTypesAndKeys_inTheirDatabase', async (): Promise<void> => {
    driver.executeQuery.mockImplementation((query: string): Promise<QueryResult> =>
      Promise.resolve(
        query.includes('db.labels')
          ? result(['label'], [['Movie'], ['Person']])
          : query.includes('db.relationshipTypes')
            ? result(['relationshipType'], [['ACTED_IN']])
            : result(['propertyKey'], [['title']]),
      ),
    );
    const session: EngineSession = await open();

    const labels: readonly DatabaseNode[] = await session.expand(
      encodePath('db', 'movies', 'labels'),
    );
    const types: readonly DatabaseNode[] = await session.expand(
      encodePath('db', 'movies', 'types'),
    );
    const keys: readonly DatabaseNode[] = await session.expand(encodePath('db', 'movies', 'keys'));

    expect(driver.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('db.labels'),
      {},
      {
        database: 'movies',
      },
    );
    expect(labels.map((entry: DatabaseNode): string => entry.label)).toEqual(['Movie', 'Person']);
    expect(labels[0]).toMatchObject({
      path: encodePath('db', 'movies', 'labels', 'Movie'),
      icon: 'label',
      leaf: true,
      actions: [{ id: 'match-nodes', label: 'Match 25 Nodes' }],
    });
    expect(types[0]).toMatchObject({
      label: 'ACTED_IN',
      icon: 'relationship',
      actions: [{ id: 'match-relationships', label: 'Match 25 Relationships' }],
    });
    expect(keys[0]).toMatchObject({ label: 'title', icon: 'property', leaf: true });
  });

  it('expand_listsIndexesAndConstraints_withWhatTheyAreOn', async (): Promise<void> => {
    driver.executeQuery.mockImplementation((query: string): Promise<QueryResult> =>
      Promise.resolve(
        result(
          ['name', 'type', 'labelsOrTypes', 'properties'],
          [
            [
              query.includes('INDEXES') ? 'movie_title' : 'person_name',
              'RANGE',
              ['Movie'],
              ['title'],
            ],
          ],
        ),
      ),
    );
    const session: EngineSession = await open();

    const indexes: readonly DatabaseNode[] = await session.expand(
      encodePath('db', 'movies', 'indexes'),
    );
    const constraints: readonly DatabaseNode[] = await session.expand(
      encodePath('db', 'movies', 'constraints'),
    );

    expect(indexes).toEqual([
      {
        path: encodePath('db', 'movies', 'indexes', 'movie_title'),
        label: 'movie_title',
        detail: 'RANGE',
        icon: 'index',
        leaf: true,
        database: 'movies',
        properties: [
          { name: 'Name', value: 'movie_title' },
          { name: 'Type', value: 'RANGE' },
          { name: 'On', value: 'Movie(title)' },
        ],
      },
    ]);
    expect(constraints[0]).toMatchObject({ label: 'person_name', icon: 'constraint' });
  });

  it('expand_findsNothingInAFolderItDoesNotKnow', async (): Promise<void> => {
    expect(await (await open()).expand(encodePath('db', 'movies', 'tables'))).toEqual([]);
  });

  it('execute_runsEachStatementInOneSession_withRowsGraphValuesAndMessages', async (): Promise<void> => {
    const ada: Node = node('4:db:1', ['Person'], { name: 'Ada' });
    answer((text: string): QueryResult => {
      if (text.startsWith('CREATE')) {
        return result([], [], { stats: { 'nodes-created': 1 } });
      }
      return result(['n', 'count'], [[ada, neo4j.int(3)]]);
    });
    const session: EngineSession = await open({ database: 'movies' });

    const execution: EngineExecution = await run(
      session,
      "CREATE (:Person {name: 'Ada'});\n// a comment\nMATCH (n) RETURN n, count(*) AS count;",
      20,
    );

    expect(driver.session).toHaveBeenCalledTimes(1);
    expect(driver.session).toHaveBeenCalledWith({ database: 'movies' });
    expect(sessions[0].run.mock.calls.map((call: [string]): string => call[0])).toEqual([
      "CREATE (:Person {name: 'Ada'})",
      // Cypher's `//` comment is a comment, not the start of the statement.
      '// a comment\nMATCH (n) RETURN n, count(*) AS count',
    ]);
    expect(execution).toEqual({
      resultSets: [
        {
          columns: [{ name: 'n' }, { name: 'count' }],
          rows: [[nodeValue(ada), 3]],
          line: 22,
        },
      ],
      messages: [
        { severity: 'info', text: '1 nodes created; 0 rows returned', line: 20 },
        { severity: 'info', text: '1 row returned', line: 22 },
      ],
      failed: false,
      cancelled: false,
    });
    expect(sessions[0].close).toHaveBeenCalled();
  });

  it('execute_showsTheColumns_ofAQueryThatMatchesNothing', async (): Promise<void> => {
    answer((): QueryResult => result(['title', 'released'], []));

    const execution: EngineExecution = await run(
      await open(),
      'MATCH (m:Nothing) RETURN m.title AS title, m.released AS released',
    );

    expect(execution.resultSets).toEqual([
      { columns: [{ name: 'title' }, { name: 'released' }], rows: [], line: 1 },
    ]);
  });

  it('execute_keepsTheFirstRowsOfALargeResult_andSaysSo', async (): Promise<void> => {
    const rows: unknown[][] = Array.from({ length: MAX_RESULT_ROWS + 5 }, (): unknown[] => [1]);
    answer((): QueryResult => result(['n'], rows));

    const execution: EngineExecution = await run(await open(), 'UNWIND range(1, 10) AS n RETURN n');

    expect(execution.resultSets[0].rows).toHaveLength(MAX_RESULT_ROWS);
    expect(execution.messages).toEqual([
      {
        severity: 'warning',
        text: `${MAX_RESULT_ROWS + 5} rows returned; the first ${MAX_RESULT_ROWS} are kept`,
        line: 1,
      },
    ]);
  });

  it('execute_runsAgainstTheRequestsDatabase_orTheDefault', async (): Promise<void> => {
    const session: EngineSession = await open({ database: '  ' });

    await run(session, 'RETURN 1');
    await session.execute({
      id: 'run-2',
      session: 's1',
      text: 'RETURN 1',
      firstLine: 1,
      database: 'movies',
    });

    expect(driver.session.mock.calls).toEqual([[{ database: 'neo4j' }], [{ database: 'movies' }]]);
  });

  it('execute_reportsTheServersNotifications_asWarningsOnTheirLine', async (): Promise<void> => {
    answer((): QueryResult =>
      result(['n'], [], {
        notifications: [
          {
            code: 'Neo.ClientNotification.Statement.CartesianProduct',
            title: 'This query builds a cartesian product',
            description: 'Consider adding a relationship.',
            severity: 'INFORMATION',
            position: { offset: 12, line: 2, column: 1 },
          },
        ],
      }),
    );

    const execution: EngineExecution = await run(
      await open(),
      'MATCH (a)\nMATCH (b)\nRETURN a, b',
      5,
    );

    expect(execution.messages).toEqual([
      { severity: 'info', text: '0 rows returned', line: 5 },
      {
        severity: 'warning',
        text: 'This query builds a cartesian product: Consider adding a relationship.',
        line: 6,
      },
    ]);
  });

  it('execute_mapsAnErrorsLineIntoTheDocument_andStopsThere', async (): Promise<void> => {
    answer((text: string): QueryResult => {
      if (text.includes('RETRN')) {
        throw new Error("Invalid input 'RETRN': expected 'RETURN' (line 2, column 1 (offset: 10))");
      }
      return result(['x'], [[1]]);
    });

    const execution: EngineExecution = await run(
      await open(),
      'RETURN 1 AS x;\nMATCH (n)\nRETRN n;\nRETURN 1 AS x;',
      10,
    );

    expect(execution.failed).toBe(true);
    expect(execution.cancelled).toBe(false);
    expect(execution.resultSets).toHaveLength(1);
    expect(execution.messages.at(-1)).toEqual({
      severity: 'error',
      text: "Invalid input 'RETRN': expected 'RETURN' (line 2, column 1 (offset: 10))",
      line: 12,
    });
    expect(sessions[0].run).toHaveBeenCalledTimes(2);
  });

  it('execute_reportsAnErrorWithoutALine_onItsStatementsLine', async (): Promise<void> => {
    answer((): never => {
      throw new Error('The client is unauthorized due to authentication failure.');
    });

    const execution: EngineExecution = await run(await open(), '\nRETURN 1', 1);

    expect(execution.messages).toEqual([
      {
        severity: 'error',
        text: 'The client is unauthorized due to authentication failure.',
        line: 2,
      },
    ]);
  });

  it('cancel_closesTheRunningSession_andTheOutcomeReadsAsCancelledNotFailed', async (): Promise<void> => {
    let started: () => void = (): void => undefined;
    const running: Promise<void> = new Promise<void>((resolve: () => void): void => {
      started = resolve;
    });
    let fail: (error: Error) => void = (): void => undefined;
    const bolt: FakeSession = {
      run: vi.fn((): Running =>
        asRunning(
          new Promise<QueryResult>((_: unknown, reject: (error: Error) => void): void => {
            fail = reject;
            started();
          }),
        ),
      ),
      close: vi.fn((): Promise<void> => {
        fail(new Error('Pool is closed, it is no more able to serve requests.'));
        return Promise.resolve();
      }),
    };
    driver.session.mockReturnValueOnce(bolt);
    const session: EngineSession = await open();

    const execution: Promise<EngineExecution> = run(
      session,
      'CALL apoc.util.sleep(60000);\nRETURN 1;',
      1,
      'run-9',
    );
    await running;
    session.cancel('run-9');

    expect(await execution).toEqual({
      resultSets: [],
      messages: [{ severity: 'warning', text: 'The query was cancelled.', line: 1 }],
      failed: false,
      cancelled: true,
    });
    expect(bolt.run).toHaveBeenCalledTimes(1);
  });

  it('cancel_ignoresAnExecutionThatIsNotRunning', async (): Promise<void> => {
    const session: EngineSession = await open();

    session.cancel('nothing');

    expect(driver.session).not.toHaveBeenCalled();
    expect((await run(session, 'RETURN 1', 1, 'nothing')).cancelled).toBe(false);
  });

  it('action_buildsTheQueriesTheTreeOffers', async (): Promise<void> => {
    const session: EngineSession = await open();

    expect(await session.action(encodePath('db', 'movies'), 'schema')).toEqual({
      kind: 'script',
      reads: true,
      title: 'movies schema',
      text: 'CALL db.schema.visualization();\n',
      database: 'movies',
    });
    expect(
      await session.action(encodePath('db', 'movies', 'labels', 'Odd`Label'), 'match-nodes'),
    ).toMatchObject({ text: 'MATCH (n:`Odd``Label`)\nRETURN n\nLIMIT 25;\n', title: 'Odd`Label' });
    expect(
      await session.action(encodePath('db', 'movies', 'types', 'ACTED_IN'), 'match-relationships'),
    ).toMatchObject({ text: 'MATCH p = ()-[r:`ACTED_IN`]->()\nRETURN p\nLIMIT 25;\n' });
    expect(await session.action(encodePath('db', 'movies'), 'drop')).toEqual({
      kind: 'failure',
      message: "Unknown action 'drop'.",
    });
    expect(await session.action('garbage', 'schema')).toEqual({
      kind: 'failure',
      message: 'Nothing to act on.',
    });
  });

  it('close_closesTheDriver', async (): Promise<void> => {
    const session: EngineSession = await new Neo4jEngine().connect({ uri: 'neo4j://x' });

    await session.close();

    expect(driver.close).toHaveBeenCalledTimes(1);
  });
});
