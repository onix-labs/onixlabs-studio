import { int } from 'neo4j-driver';
import { describe, expect, it } from 'vitest';
import { PlanNode } from '../../protocol/database/protocol';
import { neo4jPlanTree, plainPlan } from './neo4j-plan';

/**
 * A profile as the driver hands it back for `PROFILE MATCH (p:Person) RETURN p.name`.
 */
const PROFILE: unknown = {
  operatorType: 'ProduceResults@neo4j',
  identifiers: ['p', '`p.name`'],
  arguments: { Details: '`p.name`', EstimatedRows: 10, planner: 'COST', runtime: 'PIPELINED' },
  dbHits: int(0),
  rows: int(3),
  pageCacheHits: 0,
  pageCacheMisses: 0,
  time: 0,
  children: [
    {
      operatorType: 'NodeByLabelScan@neo4j',
      identifiers: ['p'],
      arguments: { Details: 'p:Person', EstimatedRows: int(10) },
      dbHits: int(4),
      rows: int(3),
      children: [],
    },
  ],
};

describe('neo4jPlanTree', () => {
  it('mapsEachStep_withoutTheServersSuffix_itsDetailsEstimateAndActualRows', () => {
    const root: PlanNode = neo4jPlanTree(PROFILE);

    expect(root).toMatchObject({
      operator: 'ProduceResults',
      detail: '`p.name`',
      estimatedRows: 10,
      actualRows: 3,
    });
    expect(root.children[0]).toMatchObject({
      operator: 'NodeByLabelScan',
      detail: 'p:Person',
      estimatedRows: 10,
      actualRows: 3,
    });
  });

  it('keepsIdentifiersArgumentsAndCounters_asProperties', () => {
    const root: PlanNode = neo4jPlanTree(PROFILE);

    expect(root.properties).toEqual([
      { name: 'Identifiers', value: 'p, `p.name`' },
      { name: 'planner', value: 'COST' },
      { name: 'runtime', value: 'PIPELINED' },
      { name: 'DB Hits', value: '0' },
      { name: 'Page Cache Hits', value: '0' },
      { name: 'Page Cache Misses', value: '0' },
      { name: 'Time', value: '0' },
    ]);
    expect(root.children[0]?.properties).toContainEqual({ name: 'DB Hits', value: '4' });
  });

  it('leavesTheActualsOut_ofAnExplainedPlan', () => {
    expect(
      neo4jPlanTree({ operatorType: 'AllNodesScan', identifiers: [], arguments: {}, children: [] }),
    ).toEqual({ operator: 'AllNodesScan', children: [] });
  });
});

describe('plainPlan', () => {
  it('turnsTheDriversIntegersIntoNumbers_forTheRawPlan', () => {
    expect(plainPlan({ rows: int(3), children: [{ dbHits: int(4) }] })).toEqual({
      rows: 3,
      children: [{ dbHits: 4 }],
    });
  });
});
