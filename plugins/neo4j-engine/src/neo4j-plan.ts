import { PlanNode, PlanProperty } from '../../protocol/database/protocol';

/**
 * The arguments of a Neo4j plan step the common tree reads itself, which are therefore not repeated
 * among the step's properties.
 */
const MAPPED_ARGUMENTS: ReadonlySet<string> = new Set<string>(['Details', 'EstimatedRows']);

/**
 * The profiling counters a profiled step carries beside its arguments, shown as properties.
 */
const COUNTERS: readonly { readonly key: string; readonly name: string }[] = [
  { key: 'dbHits', name: 'DB Hits' },
  { key: 'pageCacheHits', name: 'Page Cache Hits' },
  { key: 'pageCacheMisses', name: 'Page Cache Misses' },
  { key: 'time', name: 'Time' },
];

/**
 * Builds the plan tree from the plan an `EXPLAIN` answers with, or the profile a `PROFILE` does. Each
 * step's operator is its `operatorType` (without the `@neo4j` suffix newer servers add); its detail is
 * the `Details` argument; `EstimatedRows` is the estimate; a profiled step's `rows` are its actual
 * rows. Its identifiers, the other arguments and the profiling counters become properties, as the
 * server reports them: Neo4j's own units are not converted.
 * @param plan The driver's plan or profile.
 * @returns Returns the plan's top step.
 */
export function neo4jPlanTree(plan: unknown): PlanNode {
  const raw: Record<string, unknown> = record(plan);
  const args: Record<string, unknown> = record(raw['arguments']);
  const identifiers: readonly string[] = Array.isArray(raw['identifiers'])
    ? raw['identifiers'].map(String)
    : [];
  const properties: PlanProperty[] = [
    ...(identifiers.length === 0 ? [] : [{ name: 'Identifiers', value: identifiers.join(', ') }]),
    ...Object.entries(args)
      .filter(
        ([key, value]: [string, unknown]): boolean => !MAPPED_ARGUMENTS.has(key) && scalar(value),
      )
      .map(([key, value]: [string, unknown]): PlanProperty => ({ name: key, value: show(value) })),
    ...COUNTERS.filter(({ key }): boolean => numberOf(raw[key]) !== undefined).map(
      ({ key, name }): PlanProperty => ({ name, value: show(raw[key]) }),
    ),
  ];
  const details: unknown = args['Details'];
  const estimated: number | undefined = numberOf(args['EstimatedRows']);
  const actual: number | undefined = numberOf(raw['rows']);
  const children: readonly unknown[] = Array.isArray(raw['children']) ? raw['children'] : [];
  return {
    operator: (typeof raw['operatorType'] === 'string' ? raw['operatorType'] : 'Plan').replace(
      /@neo4j$/,
      '',
    ),
    ...(typeof details === 'string' && details !== '' ? { detail: details } : {}),
    ...(estimated === undefined ? {} : { estimatedRows: estimated }),
    ...(actual === undefined ? {} : { actualRows: actual }),
    ...(properties.length === 0 ? {} : { properties }),
    children: children.map(neo4jPlanTree),
  };
}

/**
 * Turns the driver's plan into plain JSON, its 64-bit integers made numbers, for the raw plan.
 * @param value The plan, or any part of it.
 * @returns Returns the plain value.
 */
export function plainPlan(value: unknown): unknown {
  const number: number | undefined = integerOf(value);
  if (number !== undefined) {
    return number;
  }
  if (Array.isArray(value)) {
    return value.map(plainPlan);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]: [string, unknown]): [string, unknown] => [
        key,
        plainPlan(item),
      ]),
    );
  }
  return value;
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
 * Reads the driver's 64-bit integer (an object with `toNumber`) as a number.
 * @param value The value.
 * @returns Returns the number, or undefined when it is not one.
 */
function integerOf(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('low' in value) || !('high' in value)) {
    return undefined;
  }
  const toNumber: unknown = (value as { readonly toNumber?: unknown }).toNumber;
  return typeof toNumber === 'function' ? (toNumber as () => number).call(value) : undefined;
}

/**
 * Reads a number, plain or the driver's 64-bit integer.
 * @param value The value.
 * @returns Returns it, or undefined.
 */
function numberOf(value: unknown): number | undefined {
  const number: number | undefined = typeof value === 'number' ? value : integerOf(value);
  return number !== undefined && Number.isFinite(number) ? number : undefined;
}

/**
 * Determines whether an argument is worth a property: a string, a number or a flag.
 * @param value The value.
 * @returns Returns true when it is shown.
 */
function scalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'boolean' || numberOf(value) !== undefined;
}

/**
 * Writes an argument as text.
 * @param value The value.
 * @returns Returns the text.
 */
function show(value: unknown): string {
  return String(numberOf(value) ?? value);
}
