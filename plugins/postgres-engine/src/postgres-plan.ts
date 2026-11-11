import { PlanNode, PlanProperty } from '../../protocol/database/protocol';

/**
 * The keys of a PostgreSQL plan step the common tree reads itself, which are therefore not repeated
 * among the step's properties.
 */
const MAPPED_KEYS: ReadonlySet<string> = new Set<string>([
  'Node Type',
  'Relation Name',
  'Alias',
  'Index Name',
  'Join Type',
  'Total Cost',
  'Plan Rows',
  'Actual Rows',
  'Actual Total Time',
  'Plans',
]);

/**
 * Builds the plan tree from `EXPLAIN (FORMAT JSON)`'s document: an array holding one object whose
 * `Plan` is the top step. Each step's operator is its `Node Type`; what it reads (`on books b using
 * books_by_title`, an `Inner` join) is its detail; `Total Cost` and `Plan Rows` are the estimates;
 * `Actual Rows` and `Actual Total Time` (milliseconds) are there when the plan was analyzed, both per
 * loop as PostgreSQL reports them, with `Actual Loops` among the properties. Every other fact the step
 * carries becomes a property, and the planning and execution times are the top step's.
 * @param document The parsed document.
 * @returns Returns the plan's top step.
 */
export function postgresPlanTree(document: unknown): PlanNode {
  const entry: Record<string, unknown> = record(Array.isArray(document) ? document[0] : document);
  const root: PlanNode = step(record(entry['Plan']));
  const timings: readonly PlanProperty[] = ['Planning Time', 'Execution Time']
    .filter((key: string): boolean => typeof entry[key] === 'number')
    .map((key: string): PlanProperty => ({ name: key, value: `${entry[key] as number} ms` }));
  return timings.length === 0
    ? root
    : { ...root, properties: [...(root.properties ?? []), ...timings] };
}

/**
 * Maps one plan step and the steps under it.
 * @param raw The step's object.
 * @returns Returns the step.
 */
function step(raw: Record<string, unknown>): PlanNode {
  const relation: string | undefined = textOf(raw['Relation Name']);
  const alias: string | undefined = textOf(raw['Alias']);
  const index: string | undefined = textOf(raw['Index Name']);
  const join: string | undefined = textOf(raw['Join Type']);
  const detail: string = [
    relation === undefined
      ? undefined
      : `on ${relation}${alias !== undefined && alias !== relation ? ` ${alias}` : ''}`,
    index === undefined ? undefined : `using ${index}`,
    join,
  ]
    .filter((part: string | undefined): part is string => part !== undefined)
    .join(' ');
  const properties: readonly PlanProperty[] = Object.entries(raw)
    .filter(([key, value]: [string, unknown]): boolean => !MAPPED_KEYS.has(key) && shown(value))
    .map(([key, value]: [string, unknown]): PlanProperty => ({ name: key, value: show(value) }));
  const children: readonly unknown[] = Array.isArray(raw['Plans']) ? raw['Plans'] : [];
  return {
    operator: textOf(raw['Node Type']) ?? 'Plan',
    ...(detail === '' ? {} : { detail }),
    ...numberField('cost', raw['Total Cost']),
    ...numberField('estimatedRows', raw['Plan Rows']),
    ...numberField('actualRows', raw['Actual Rows']),
    ...numberField('time', raw['Actual Total Time']),
    ...(properties.length === 0 ? {} : { properties }),
    children: children.map((child: unknown): PlanNode => step(record(child))),
  };
}

/**
 * Reads a value as an object, or an empty one.
 * @param value The value.
 * @returns Returns the object.
 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Reads a non-empty string.
 * @param value The value.
 * @returns Returns it, or undefined.
 */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Sets a numeric field only when the value is a number.
 * @param name The field.
 * @param value The value.
 * @returns Returns the field, or nothing.
 */
function numberField(name: string, value: unknown): Record<string, number> {
  return typeof value === 'number' && Number.isFinite(value) ? { [name]: value } : {};
}

/**
 * Determines whether a fact is worth a property: a scalar, or a list of them.
 * @param value The value.
 * @returns Returns true when it is shown.
 */
function shown(value: unknown): boolean {
  return Array.isArray(value)
    ? value.every((item: unknown): boolean => typeof item !== 'object')
    : value !== null && typeof value !== 'object';
}

/**
 * Writes a fact as text.
 * @param value The value.
 * @returns Returns the text.
 */
function show(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value);
}
