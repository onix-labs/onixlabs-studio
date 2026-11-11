import { describe, expect, it } from 'vitest';
import { PlanNode } from '../../protocol/database/protocol';
import { postgresPlanTree } from './postgres-plan';

/**
 * A plan as `EXPLAIN (ANALYZE, FORMAT JSON)` writes it: a hash join over a sequential scan and an
 * index scan.
 */
const ANALYZED: unknown = [
  {
    Plan: {
      'Node Type': 'Hash Join',
      'Join Type': 'Inner',
      'Startup Cost': 1.2,
      'Total Cost': 42.5,
      'Plan Rows': 100,
      'Plan Width': 36,
      'Actual Total Time': 0.83,
      'Actual Rows': 97,
      'Actual Loops': 1,
      'Hash Cond': '(b.author_id = a.id)',
      Plans: [
        {
          'Node Type': 'Seq Scan',
          'Parent Relationship': 'Outer',
          'Relation Name': 'books',
          Alias: 'b',
          'Total Cost': 22,
          'Plan Rows': 1200,
          Filter: "(title <> ''::text)",
        },
        {
          'Node Type': 'Index Scan',
          'Relation Name': 'authors',
          Alias: 'authors',
          'Index Name': 'authors_pkey',
          'Total Cost': 8.3,
          'Plan Rows': 1,
          'Sort Key': ['name', 'id'],
          Plans: [],
        },
      ],
    },
    'Planning Time': 0.12,
    'Execution Time': 0.9,
  },
];

describe('postgresPlanTree', () => {
  it('mapsEachStep_operatorDetailEstimatesAndActuals', () => {
    const root: PlanNode = postgresPlanTree(ANALYZED);

    expect(root).toMatchObject({
      operator: 'Hash Join',
      detail: 'Inner',
      cost: 42.5,
      estimatedRows: 100,
      actualRows: 97,
      time: 0.83,
    });
    expect(root.children.map((child: PlanNode): string | undefined => child.detail)).toEqual([
      'on books b',
      'on authors using authors_pkey',
    ]);
  });

  it('keepsTheOtherFactsAsProperties_andTheTimingsOnTheTopStep', () => {
    const root: PlanNode = postgresPlanTree(ANALYZED);

    expect(root.properties).toEqual(
      expect.arrayContaining([
        { name: 'Hash Cond', value: '(b.author_id = a.id)' },
        { name: 'Actual Loops', value: '1' },
        { name: 'Planning Time', value: '0.12 ms' },
        { name: 'Execution Time', value: '0.9 ms' },
      ]),
    );
    expect(root.children[1]?.properties).toContainEqual({ name: 'Sort Key', value: 'name, id' });
    // Read into the common fields, so not repeated as properties.
    expect(root.properties?.some((property) => property.name === 'Total Cost')).toBe(false);
  });

  it('leavesTheActualsOut_ofAPlanThatWasOnlyEstimated', () => {
    const root: PlanNode = postgresPlanTree([
      { Plan: { 'Node Type': 'Result', 'Total Cost': 0.01 } },
    ]);

    expect(root).toEqual({ operator: 'Result', cost: 0.01, children: [] });
  });

  it('copesWithADocumentThatIsNotAPlan', () => {
    expect(postgresPlanTree(null)).toEqual({ operator: 'Plan', children: [] });
  });
});
