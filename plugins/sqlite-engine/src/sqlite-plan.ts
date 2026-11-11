import { PlanNode } from '../../protocol/database/protocol';

/**
 * One row of `EXPLAIN QUERY PLAN`: the step's id, the step it belongs under, and what it does.
 */
export interface SqlitePlanRow {
  /**
   * Gets the step's id.
   */
  readonly id: number;

  /**
   * Gets the id of the step it belongs under; 0 for a top-level step.
   */
  readonly parent: number;

  /**
   * Gets what SQLite says the step does: `SCAN users`, `SEARCH users USING INDEX idx (id=?)`.
   */
  readonly detail: string;
}

/**
 * A plan step while the tree is being built, its children still growing.
 */
interface GrowingNode {
  readonly operator: string;
  readonly detail?: string;
  readonly children: GrowingNode[];
}

/**
 * Builds the plan tree from `EXPLAIN QUERY PLAN`'s rows, under one `QUERY PLAN` step as the SQLite
 * shell draws it. `SCAN` and `SEARCH` steps are split into the operator and what it reads; any other
 * step (`USE TEMP B-TREE FOR ORDER BY`, `CO-ROUTINE`) is its own operator. A row whose parent is
 * missing is kept, at the top, rather than lost.
 * @param rows The rows, in SQLite's order.
 * @returns Returns the plan's top step.
 */
export function sqlitePlanTree(rows: readonly SqlitePlanRow[]): PlanNode {
  const root: GrowingNode = { operator: 'QUERY PLAN', children: [] };
  const steps: Map<number, GrowingNode> = new Map<number, GrowingNode>();
  for (const row of rows) {
    const split: RegExpExecArray | null = /^(SCAN|SEARCH)\s+(.+)$/s.exec(row.detail.trim());
    const step: GrowingNode =
      split === null
        ? { operator: row.detail.trim(), children: [] }
        : { operator: split[1], detail: split[2], children: [] };
    (steps.get(row.parent) ?? root).children.push(step);
    steps.set(row.id, step);
  }
  return root;
}
