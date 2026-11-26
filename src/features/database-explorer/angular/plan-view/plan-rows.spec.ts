import { describe, expect, it } from 'vitest';
import { PlanNode, QueryPlan } from '@shared/api/database-engine-protocol';
import { planFigures, planProperties, PlanRow, planRows, rawPlanLanguage } from './plan-rows';

/**
 * Wraps a top step as a statement's plan.
 * @param root The top step.
 * @param raw The engine's own plan.
 * @returns Returns the plan.
 */
function planOf(root: PlanNode, raw: string = ''): QueryPlan {
  return { statement: 'select 1', line: 1, root, raw };
}

/**
 * Reads each row as its depth and step, for a compact assertion of the tree's shape.
 * @param rows The rows.
 * @returns Returns one line per row, indented by its depth.
 */
function outline(rows: readonly PlanRow[]): readonly string[] {
  return rows.map(
    (row: PlanRow): string =>
      `${'  '.repeat(row.depth)}${row.operator}${row.detail ? ` ${row.detail}` : ''}`,
  );
}

/**
 * SQLite's `EXPLAIN QUERY PLAN`, as the SQLite engine describes it: a `QUERY PLAN` step over what it
 * does, with no figures at all.
 */
const SQLITE: QueryPlan = planOf(
  {
    operator: 'QUERY PLAN',
    children: [
      { operator: 'SEARCH', detail: 'users USING INDEX users_by_email (email=?)', children: [] },
      {
        operator: 'CO-ROUTINE',
        children: [{ operator: 'SCAN', detail: 'orders', children: [] }],
      },
      { operator: 'USE TEMP B-TREE FOR ORDER BY', children: [] },
    ],
  },
  '[{"id":2,"parent":0,"detail":"SEARCH users"}]',
);

/**
 * PostgreSQL's `EXPLAIN (ANALYZE, FORMAT JSON)`, as the PostgreSQL engine describes it: costs and
 * estimates on every step, actual rows and times, and the engine's other facts as properties.
 */
const POSTGRES: QueryPlan = planOf(
  {
    operator: 'Hash Join',
    detail: 'Inner',
    cost: 1234.5678,
    estimatedRows: 50,
    actualRows: 4200,
    time: 12.34567,
    properties: [
      { name: 'Hash Cond', value: '(b.author_id = a.id)' },
      { name: 'Execution Time', value: '13.1 ms' },
    ],
    children: [
      {
        operator: 'Seq Scan',
        detail: 'on books b',
        cost: 900,
        estimatedRows: 10000,
        actualRows: 9800,
        time: 4,
        children: [],
      },
      {
        operator: 'Hash',
        cost: 30,
        estimatedRows: 200,
        actualRows: 200,
        time: 0.5,
        children: [
          {
            operator: 'Index Scan',
            detail: 'on authors a using authors_pkey',
            cost: 20,
            estimatedRows: 200,
            actualRows: 200,
            time: 0.3,
            children: [],
          },
        ],
      },
    ],
  },
  '[\n  {\n    "Plan": {}\n  }\n]',
);

/**
 * Neo4j's `PROFILE`, as the Neo4j engine describes it: estimated and actual rows, no cost, and the
 * profiling counters as properties.
 */
const NEO4J: QueryPlan = planOf({
  operator: 'ProduceResults',
  detail: 'p',
  estimatedRows: 3.5,
  actualRows: 3,
  properties: [{ name: 'DB Hits', value: '0' }],
  children: [
    {
      operator: 'NodeByLabelScan',
      detail: 'p:Person',
      estimatedRows: 3.5,
      actualRows: 3,
      properties: [{ name: 'DB Hits', value: '4' }],
      children: [],
    },
  ],
});

/**
 * SQL Server's estimated showplan, as the SQL Server engine describes it: the statement over its
 * operators, with costs and fractional row estimates and no actual figures.
 */
const SQLSERVER: QueryPlan = planOf(
  {
    operator: 'SELECT',
    cost: 0.0391,
    estimatedRows: 120,
    properties: [{ name: 'StatementOptmLevel', value: 'FULL' }],
    children: [
      {
        operator: 'Hash Match',
        detail: 'Inner Join',
        cost: 0.0391,
        estimatedRows: 120,
        children: [
          {
            operator: 'Clustered Index Scan',
            detail: '[dbo].[authors].[PK_authors]',
            cost: 0.0032,
            estimatedRows: 40,
            children: [],
          },
          {
            operator: 'Index Seek',
            detail: '[dbo].[books].[books_by_year]',
            cost: 0.0188,
            estimatedRows: 120.5,
            children: [],
          },
        ],
      },
    ],
  },
  '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">',
);

describe('planRows', () => {
  it('sqlite_drawsTheTreeInOrder_withNoFigureColumns', () => {
    const rows: readonly PlanRow[] = planRows(SQLITE, 0);

    expect(outline(rows)).toEqual([
      'QUERY PLAN',
      '  SEARCH users USING INDEX users_by_email (email=?)',
      '  CO-ROUTINE',
      '    SCAN orders',
      '  USE TEMP B-TREE FOR ORDER BY',
    ]);
    expect(planFigures(rows)).toEqual({
      cost: false,
      estimatedRows: false,
      actualRows: false,
      time: false,
    });
    expect(rows.map((row: PlanRow): string => row.id)).toEqual([
      '0:0',
      '0:0.0',
      '0:0.1',
      '0:0.1.0',
      '0:0.2',
    ]);
  });

  it('postgres_formatsEveryFigure_andMarksTheJoinWhoseEstimateWasFarOut', () => {
    const rows: readonly PlanRow[] = planRows(POSTGRES, 1);

    expect(outline(rows)).toEqual([
      'Hash Join Inner',
      '  Seq Scan on books b',
      '  Hash',
      '    Index Scan on authors a using authors_pkey',
    ]);
    expect(planFigures(rows)).toEqual({
      cost: true,
      estimatedRows: true,
      actualRows: true,
      time: true,
    });
    expect(rows[0]).toMatchObject({
      id: '1:0',
      cost: '1,234.57',
      estimatedRows: '50',
      actualRows: '4,200',
      time: '12.346',
    });
    expect(rows[0]?.misestimate).toBe('The planner estimated 50 rows, but the step produced 4,200');
    expect(rows.slice(1).map((row: PlanRow): string | undefined => row.misestimate)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('neo4j_showsEstimatedAndActualRows_withNoCostColumn', () => {
    const rows: readonly PlanRow[] = planRows(NEO4J, 0);

    expect(outline(rows)).toEqual(['ProduceResults p', '  NodeByLabelScan p:Person']);
    expect(planFigures(rows)).toEqual({
      cost: false,
      estimatedRows: true,
      actualRows: true,
      time: false,
    });
    expect(rows[1]).toMatchObject({ estimatedRows: '3.5', actualRows: '3' });
    expect(rows[1]?.misestimate).toBeUndefined();
  });

  it('sqlserver_drawsTheStatementOverItsOperators_withEstimatesOnly', () => {
    const rows: readonly PlanRow[] = planRows(SQLSERVER, 0);

    expect(outline(rows)).toEqual([
      'SELECT',
      '  Hash Match Inner Join',
      '    Clustered Index Scan [dbo].[authors].[PK_authors]',
      '    Index Seek [dbo].[books].[books_by_year]',
    ]);
    expect(planFigures(rows)).toEqual({
      cost: true,
      estimatedRows: true,
      actualRows: false,
      time: false,
    });
    expect(rows[3]).toMatchObject({ cost: '0.02', estimatedRows: '120.5' });
  });

  it('labels_eachStepWithItsOperatorAndDetail_forItsTooltip', () => {
    const rows: readonly PlanRow[] = planRows(SQLITE, 0);

    expect(rows[0]?.label).toBe('QUERY PLAN');
    expect(rows[3]?.label).toBe('SCAN orders');
  });

  it('misestimate_takesACountUnderOneAsOne', () => {
    const rows: readonly PlanRow[] = planRows(
      planOf({ operator: 'Scan', estimatedRows: 0.2, actualRows: 9, children: [] }),
      0,
    );

    expect(rows[0]?.misestimate).toBeUndefined();
  });
});

describe('planProperties', () => {
  it('listsTheFiguresUnderStudiosNames_thenTheEnginesOwnFacts', () => {
    expect(planProperties(POSTGRES.root)).toEqual([
      { name: 'Operator', value: 'Hash Join' },
      { name: 'Detail', value: 'Inner' },
      { name: 'Estimated cost', value: '1,234.5678' },
      { name: 'Estimated rows', value: '50' },
      { name: 'Actual rows', value: '4,200' },
      { name: 'Time (ms)', value: '12.346' },
      { name: 'Hash Cond', value: '(b.author_id = a.id)' },
      { name: 'Execution Time', value: '13.1 ms' },
    ]);
  });

  it('leavesOutTheFiguresAStepDoesNotHave', () => {
    expect(planProperties(SQLITE.root.children[0])).toEqual([
      { name: 'Operator', value: 'SEARCH' },
      { name: 'Detail', value: 'users USING INDEX users_by_email (email=?)' },
    ]);
  });
});

describe('rawPlanLanguage', () => {
  it('readsJsonXmlOrPlainText_fromTheEnginesPlan', () => {
    expect(rawPlanLanguage(POSTGRES.raw)).toBe('json');
    expect(rawPlanLanguage(SQLITE.raw)).toBe('json');
    expect(rawPlanLanguage(SQLSERVER.raw)).toBe('xml');
    expect(rawPlanLanguage('QUERY PLAN\n`--SCAN t')).toBe('plaintext');
  });
});
