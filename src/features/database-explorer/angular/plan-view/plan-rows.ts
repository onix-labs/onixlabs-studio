import { PlanNode, PlanProperty, QueryPlan } from '@shared/api/database-engine-protocol';
import { interfaceLocale } from '@shared/angular/services/locale/interface-locale';

/**
 * How far apart an estimate and the rows a step actually produced must be — this many times more, or
 * fewer — before the step is marked as misestimated. A planner an order of magnitude out is the usual
 * reason a plan goes wrong, and anything closer is noise.
 */
const MISESTIMATE_FACTOR: number = 10;

/**
 * One step of a plan as the Plan view's tree table draws it: where it sits in the tree, and its
 * figures already formatted. Every engine's plan arrives as the same tree of {@link PlanNode}s, so
 * this is the one shape Studio draws, whichever engine described it.
 */
export interface PlanRow {
  /**
   * Gets the step's identity: the statement's index and the step's path from the top step, so a
   * folded step stays folded when the same plan is explained again.
   */
  readonly id: string;

  /**
   * Gets the step's depth: 0 for the top step.
   */
  readonly depth: number;

  /**
   * Gets what the engine does, in its own words.
   */
  readonly operator: string;

  /**
   * Gets what it acts on, when the engine says.
   */
  readonly detail?: string;

  /**
   * Gets the operator and what it acts on together, for a tooltip on a step cut short.
   */
  readonly label: string;

  /**
   * Gets the planner's estimated cost, formatted, in the engine's own units.
   */
  readonly cost?: string;

  /**
   * Gets the planner's estimated row count, formatted.
   */
  readonly estimatedRows?: string;

  /**
   * Gets the rows the step actually produced, formatted, when the plan was analyzed.
   */
  readonly actualRows?: string;

  /**
   * Gets the time the step took, formatted in milliseconds, when the engine timed it.
   */
  readonly time?: string;

  /**
   * Gets what to say about a step whose estimate and actual rows are an order of magnitude apart —
   * the usual sign of stale statistics — or undefined when they are not.
   */
  readonly misestimate?: string;

  /**
   * Gets the step itself, for the Properties panel.
   */
  readonly node: PlanNode;
}

/**
 * Which figure columns a plan's tree table shows: those at least one of its steps has a value for, so
 * an engine that reports no costs (SQLite) or no estimates is not drawn with empty columns.
 */
export interface PlanFigures {
  /**
   * Gets whether any step has a cost.
   */
  readonly cost: boolean;

  /**
   * Gets whether any step has an estimated row count.
   */
  readonly estimatedRows: boolean;

  /**
   * Gets whether any step has an actual row count.
   */
  readonly actualRows: boolean;

  /**
   * Gets whether any step has a time.
   */
  readonly time: boolean;
}

/**
 * Formats a figure in the interface's locale.
 * @param value The figure.
 * @param digits The most decimal places to keep.
 * @returns Returns the text, or undefined when there is no figure.
 */
function figure(value: number | undefined, digits: number): string | undefined {
  return value === undefined || !Number.isFinite(value)
    ? undefined
    : value.toLocaleString(interfaceLocale(), { maximumFractionDigits: digits });
}

/**
 * Determines whether a step's estimate and its actual rows are an order of magnitude apart. A count
 * under one is taken as one, so an estimate of 0.5 rows against 1 actual is not flagged.
 * @param node The step.
 * @returns Returns true when they are.
 */
function misestimated(node: PlanNode): boolean {
  if (node.estimatedRows === undefined || node.actualRows === undefined) {
    return false;
  }
  const estimated: number = Math.max(1, node.estimatedRows);
  const actual: number = Math.max(1, node.actualRows);
  return Math.max(estimated, actual) / Math.min(estimated, actual) >= MISESTIMATE_FACTOR;
}

/**
 * Flattens a plan's tree into the rows of a tree table, in tree order: each step, then the steps
 * feeding it, each a level deeper.
 * @param plan The plan.
 * @param index The statement's index among the plans, which keeps rows of different statements apart.
 * @returns Returns the rows.
 */
export function planRows(plan: QueryPlan, index: number): readonly PlanRow[] {
  const rows: PlanRow[] = [];
  const visit: (node: PlanNode, path: string, depth: number) => void = (
    node: PlanNode,
    path: string,
    depth: number,
  ): void => {
    const cost: string | undefined = figure(node.cost, 2);
    const estimatedRows: string | undefined = figure(node.estimatedRows, 1);
    const actualRows: string | undefined = figure(node.actualRows, 1);
    const time: string | undefined = figure(node.time, 3);
    const misestimate: string | undefined =
      misestimated(node) && estimatedRows !== undefined && actualRows !== undefined
        ? $localize`:Tooltip on a plan step whose row estimate was far out. The figures are row counts:The planner estimated ${estimatedRows}:estimated: rows, but the step produced ${actualRows}:actual:`
        : undefined;
    rows.push({
      id: `${index}:${path}`,
      depth,
      operator: node.operator,
      label:
        node.detail === undefined || node.detail === ''
          ? node.operator
          : `${node.operator} ${node.detail}`,
      ...(node.detail === undefined || node.detail === '' ? {} : { detail: node.detail }),
      ...(cost === undefined ? {} : { cost }),
      ...(estimatedRows === undefined ? {} : { estimatedRows }),
      ...(actualRows === undefined ? {} : { actualRows }),
      ...(time === undefined ? {} : { time }),
      ...(misestimate === undefined ? {} : { misestimate }),
      node,
    });
    node.children.forEach((child: PlanNode, at: number): void =>
      visit(child, `${path}.${at}`, depth + 1),
    );
  };
  visit(plan.root, '0', 0);
  return rows;
}

/**
 * Works out which figure columns a plan's rows fill.
 * @param rows The rows.
 * @returns Returns the columns to show.
 */
export function planFigures(rows: readonly PlanRow[]): PlanFigures {
  return {
    cost: rows.some((row: PlanRow): boolean => row.cost !== undefined),
    estimatedRows: rows.some((row: PlanRow): boolean => row.estimatedRows !== undefined),
    actualRows: rows.some((row: PlanRow): boolean => row.actualRows !== undefined),
    time: rows.some((row: PlanRow): boolean => row.time !== undefined),
  };
}

/**
 * Lists a step's facts for the Properties panel: its operator and figures under Studio's names, then
 * everything else the engine reported, under the engine's.
 * @param node The step.
 * @returns Returns the facts.
 */
export function planProperties(node: PlanNode): readonly PlanProperty[] {
  const facts: (PlanProperty | undefined)[] = [
    {
      name: $localize`:A plan step's operator, in the Properties panel:Operator`,
      value: node.operator,
    },
    node.detail === undefined
      ? undefined
      : {
          name: $localize`:What a plan step acts on, in the Properties panel:Detail`,
          value: node.detail,
        },
    fact(
      $localize`:A plan step's estimated cost, in the Properties panel:Estimated cost`,
      node.cost,
      4,
    ),
    fact(
      $localize`:A plan step's estimated row count, in the Properties panel:Estimated rows`,
      node.estimatedRows,
      2,
    ),
    fact(
      $localize`:The rows a plan step actually produced, in the Properties panel:Actual rows`,
      node.actualRows,
      2,
    ),
    fact(
      $localize`:How long a plan step took, in milliseconds, in the Properties panel:Time (ms)`,
      node.time,
      3,
    ),
  ];
  return [
    ...facts.filter((each: PlanProperty | undefined): each is PlanProperty => each !== undefined),
    ...(node.properties ?? []),
  ];
}

/**
 * Builds a figure's fact, when there is a figure.
 * @param name The fact's name.
 * @param value The figure.
 * @param digits The most decimal places to keep.
 * @returns Returns the fact, or undefined.
 */
function fact(name: string, value: number | undefined, digits: number): PlanProperty | undefined {
  const text: string | undefined = figure(value, digits);
  return text === undefined ? undefined : { name, value: text };
}

/**
 * Guesses the language a raw plan is written in, for the Raw view's highlighting: JSON (PostgreSQL,
 * Neo4j, SQLite's rows), XML (SQL Server's showplan), or plain text.
 * @param raw The engine's own plan.
 * @returns Returns the editor language.
 */
export function rawPlanLanguage(raw: string): string {
  const start: string = raw.trimStart().charAt(0);
  return start === '{' || start === '[' ? 'json' : start === '<' ? 'xml' : 'plaintext';
}
