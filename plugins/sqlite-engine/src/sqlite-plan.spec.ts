import { describe, expect, it } from 'vitest';
import { PlanNode } from '../../protocol/database/protocol';
import { sqlitePlanTree } from './sqlite-plan';

/**
 * Reduces a plan to its operators, nested, so a whole tree reads in one assertion.
 * @param node The plan step.
 * @returns Returns the shape.
 */
function shape(node: PlanNode): unknown {
  return node.children.length === 0 ? node.operator : { [node.operator]: node.children.map(shape) };
}

describe('sqlitePlanTree', () => {
  it('nestsEachStepUnderItsParent_underOneQueryPlanStep', () => {
    const root: PlanNode = sqlitePlanTree([
      { id: 2, parent: 0, detail: 'CO-ROUTINE recent' },
      { id: 5, parent: 2, detail: 'SCAN books' },
      { id: 9, parent: 0, detail: 'SEARCH authors USING INTEGER PRIMARY KEY (rowid=?)' },
      { id: 14, parent: 0, detail: 'USE TEMP B-TREE FOR ORDER BY' },
    ]);

    expect(shape(root)).toEqual({
      'QUERY PLAN': [{ 'CO-ROUTINE recent': ['SCAN'] }, 'SEARCH', 'USE TEMP B-TREE FOR ORDER BY'],
    });
  });

  it('splitsAScanOrSearch_intoTheOperatorAndWhatItReads', () => {
    const root: PlanNode = sqlitePlanTree([
      { id: 3, parent: 0, detail: 'SEARCH books USING INDEX books_by_title (title=?)' },
    ]);

    expect(root.children[0]).toEqual({
      operator: 'SEARCH',
      detail: 'books USING INDEX books_by_title (title=?)',
      children: [],
    });
  });

  it('keepsAStepWhoseParentIsMissing_atTheTop', () => {
    expect(shape(sqlitePlanTree([{ id: 4, parent: 99, detail: 'SCAN t' }]))).toEqual({
      'QUERY PLAN': ['SCAN'],
    });
  });
});
