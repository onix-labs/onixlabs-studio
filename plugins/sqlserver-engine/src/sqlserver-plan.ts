import { PlanNode, PlanProperty, QueryPlan } from '../../protocol/database/protocol';

/**
 * One element of a showplan document: its name, its attributes, and the elements inside it. Showplan
 * carries everything in attributes, so text content is not kept, and it names everything in one
 * default namespace, so names are kept as written.
 */
export interface XmlElement {
  /**
   * Gets the element's name.
   */
  readonly name: string;

  /**
   * Gets its attributes, decoded, in document order.
   */
  readonly attributes: ReadonlyMap<string, string>;

  /**
   * Gets the elements inside it, in document order.
   */
  readonly children: readonly XmlElement[];
}

/**
 * An element while the document is being read, its children still growing.
 */
interface GrowingElement {
  readonly name: string;
  readonly attributes: Map<string, string>;
  readonly children: GrowingElement[];
}

/**
 * The column SQL Server names the result set a showplan arrives in, under `SET SHOWPLAN_XML` and
 * `SET STATISTICS XML` alike.
 */
export const SHOWPLAN_COLUMN: RegExp = /XML Showplan/i;

/**
 * The attributes of a `RelOp` the common tree reads itself, which are therefore not repeated among
 * the step's properties.
 */
const MAPPED_OPERATOR_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  'PhysicalOp',
  'LogicalOp',
  'EstimateRows',
  'EstimatedTotalSubtreeCost',
]);

/**
 * The attributes of a statement the common tree reads itself, or that are the statement's own text.
 */
const MAPPED_STATEMENT_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  'StatementText',
  'StatementType',
  'StatementSubTreeCost',
  'StatementEstRows',
]);

/**
 * The run-time counters summed across a parallel step's threads and shown as properties, beside the
 * actual rows the tree reads itself.
 */
const SUMMED_COUNTERS: readonly string[] = [
  'ActualExecutions',
  'ActualRowsRead',
  'ActualLogicalReads',
  'ActualPhysicalReads',
];

/**
 * Decodes the five predefined XML entities and character references.
 * @param text The encoded text.
 * @returns Returns the text.
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g,
    (match: string, hex?: string, decimal?: string, named?: string): string => {
      if (hex !== undefined) {
        return String.fromCodePoint(parseInt(hex, 16));
      }
      if (decimal !== undefined) {
        return String.fromCodePoint(parseInt(decimal, 10));
      }
      const names: Readonly<Record<string, string>> = {
        lt: '<',
        gt: '>',
        amp: '&',
        quot: '"',
        apos: "'",
      };
      return names[named ?? ''] ?? match;
    },
  );
}

/**
 * Reads a showplan document into its elements. Showplan is machine-written, well-formed XML with no
 * DTD, so a reader of tags and attributes is enough: the prolog, comments, CDATA and text between
 * tags are skipped.
 * @param xml The document.
 * @returns Returns the root element, or undefined when the text holds none.
 */
export function parseXml(xml: string): XmlElement | undefined {
  const root: GrowingElement = { name: '', attributes: new Map<string, string>(), children: [] };
  const open: GrowingElement[] = [root];
  const tag: RegExp =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][\s\S]*?>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attribute: RegExp = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of xml.matchAll(tag)) {
    const [, closing, opening, attributes, selfClosing] = match;
    if (closing !== undefined) {
      if (open.length > 1) {
        open.pop();
      }
      continue;
    }
    if (opening === undefined) {
      continue;
    }
    const element: GrowingElement = {
      name: opening,
      attributes: new Map<string, string>(),
      children: [],
    };
    for (const pair of (attributes ?? '').matchAll(attribute)) {
      element.attributes.set(pair[1] ?? '', decodeEntities(pair[2] ?? pair[3] ?? ''));
    }
    open[open.length - 1]?.children.push(element);
    if (selfClosing !== '/') {
      open.push(element);
    }
  }
  return root.children[0];
}

/**
 * Writes an element back out as indented XML, one element to a line, for the Raw view: SQL Server
 * sends its showplan as a single line.
 * @param element The element.
 * @param depth How deep it sits.
 * @returns Returns the text.
 */
export function formatXml(element: XmlElement, depth: number = 0): string {
  const indent: string = '  '.repeat(depth);
  const attributes: string = [...element.attributes]
    .map(([name, value]: [string, string]): string => ` ${name}="${encodeAttribute(value)}"`)
    .join('');
  if (element.children.length === 0) {
    return `${indent}<${element.name}${attributes} />`;
  }
  return [
    `${indent}<${element.name}${attributes}>`,
    ...element.children.map((child: XmlElement): string => formatXml(child, depth + 1)),
    `${indent}</${element.name}>`,
  ].join('\n');
}

/**
 * Encodes an attribute value for writing.
 * @param value The value.
 * @returns Returns it encoded.
 */
function encodeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Builds the plans of one showplan document: one per statement that has a query plan (a `SET` or
 * `DECLARE` has none), in the document's order. Each plan's top step is the statement itself — its
 * type, its estimated cost and rows, and its query plan's facts — over the operator tree, as SSMS
 * draws it. The raw plan is the whole document, indented.
 * @param xml The document, as the server sent it.
 * @param line The line the batch it came from starts on.
 * @returns Returns the plans.
 */
export function sqlServerPlans(xml: string, line: number): readonly QueryPlan[] {
  const document: XmlElement | undefined = parseXml(xml);
  if (document === undefined) {
    return [];
  }
  const raw: string = formatXml(document);
  return descendants(document, 'StmtSimple', undefined)
    .filter((statement: XmlElement): boolean => child(statement, 'QueryPlan') !== undefined)
    .map((statement: XmlElement): QueryPlan => ({
      statement: (statement.attributes.get('StatementText') ?? '').trim(),
      line,
      root: statementStep(statement),
      raw,
    }));
}

/**
 * Maps a statement and its operator tree.
 * @param statement The `StmtSimple` element.
 * @returns Returns the statement's step.
 */
function statementStep(statement: XmlElement): PlanNode {
  const queryPlan: XmlElement | undefined = child(statement, 'QueryPlan');
  const timeStats: XmlElement | undefined =
    queryPlan === undefined ? undefined : child(queryPlan, 'QueryTimeStats');
  const properties: readonly PlanProperty[] = [
    ...scalarAttributes(statement, MAPPED_STATEMENT_ATTRIBUTES),
    ...(queryPlan === undefined ? [] : scalarAttributes(queryPlan, new Set<string>())),
    ...(timeStats === undefined ? [] : scalarAttributes(timeStats, new Set<string>())),
  ];
  const top: XmlElement | undefined =
    queryPlan === undefined ? undefined : child(queryPlan, 'RelOp');
  return {
    operator: statement.attributes.get('StatementType') ?? 'Statement',
    ...numberField('cost', statement.attributes.get('StatementSubTreeCost')),
    ...numberField('estimatedRows', statement.attributes.get('StatementEstRows')),
    ...(properties.length === 0 ? {} : { properties }),
    children: top === undefined ? [] : [operatorStep(top)],
  };
}

/**
 * Maps one operator (`RelOp`) and the operators feeding it. Its operator is the physical one; what it
 * reads (`[dbo].[books].[PK_books]`) and its logical operation, where that differs (`Inner Join` under
 * a Hash Match), are its detail. `EstimatedTotalSubtreeCost` and `EstimateRows` are the estimates; an
 * actual plan's rows are summed across the step's threads and its time is the slowest thread's.
 * @param operator The `RelOp` element.
 * @returns Returns the step.
 */
function operatorStep(operator: XmlElement): PlanNode {
  const physical: string = operator.attributes.get('PhysicalOp') ?? 'Operator';
  const logical: string | undefined = operator.attributes.get('LogicalOp');
  const object: XmlElement | undefined = descendants(operator, 'Object', 'RelOp')[0];
  const detail: string = [logical === physical ? undefined : logical, objectName(object)]
    .filter((part: string | undefined): part is string => part !== undefined && part !== '')
    .join(' ');
  const threads: readonly XmlElement[] = descendants(operator, 'RunTimeCountersPerThread', 'RelOp');
  const actualRows: number | undefined = sum(threads, 'ActualRows');
  const times: readonly number[] = threads
    .map((thread: XmlElement): number => Number(thread.attributes.get('ActualElapsedms')))
    .filter((time: number): boolean => Number.isFinite(time));
  const properties: readonly PlanProperty[] = [
    ...scalarAttributes(operator, MAPPED_OPERATOR_ATTRIBUTES),
    ...SUMMED_COUNTERS.map((counter: string): PlanProperty | undefined => {
      const total: number | undefined = sum(threads, counter);
      return total === undefined ? undefined : { name: counter, value: String(total) };
    }).filter((each: PlanProperty | undefined): each is PlanProperty => each !== undefined),
  ];
  return {
    operator: physical,
    ...(detail === '' ? {} : { detail }),
    ...numberField('cost', operator.attributes.get('EstimatedTotalSubtreeCost')),
    ...numberField('estimatedRows', operator.attributes.get('EstimateRows')),
    ...(actualRows === undefined ? {} : { actualRows }),
    ...(times.length === 0 ? {} : { time: Math.max(...times) }),
    ...(properties.length === 0 ? {} : { properties }),
    children: descendants(operator, 'RelOp', 'RelOp', true).map(operatorStep),
  };
}

/**
 * Names the object an operator reads, as SSMS does: its schema, table and index, bracketed.
 * @param object The `Object` element, if the operator has one.
 * @returns Returns the name, or undefined.
 */
function objectName(object: XmlElement | undefined): string | undefined {
  if (object === undefined) {
    return undefined;
  }
  const parts: readonly string[] = ['Schema', 'Table', 'Index']
    .map((name: string): string | undefined => object.attributes.get(name))
    .filter((part: string | undefined): part is string => part !== undefined && part !== '');
  return parts.length === 0 ? undefined : parts.join('.');
}

/**
 * Finds the first child element of a name.
 * @param element The element.
 * @param name The child's name.
 * @returns Returns the child, or undefined.
 */
function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((each: XmlElement): boolean => each.name === name);
}

/**
 * Finds the elements of a name beneath an element, in document order, without looking inside the
 * elements named as a boundary — so an operator's own `Object` is found, not one of the operators
 * feeding it.
 * @param element The element.
 * @param name The name sought.
 * @param boundary The name not looked inside, if any.
 * @param stopAtMatch Whether a match's own descendants are skipped too, so only the nearest are found.
 * @returns Returns the elements.
 */
function descendants(
  element: XmlElement,
  name: string,
  boundary: string | undefined,
  stopAtMatch: boolean = false,
): readonly XmlElement[] {
  const found: XmlElement[] = [];
  const visit: (each: XmlElement) => void = (each: XmlElement): void => {
    for (const inner of each.children) {
      if (inner.name === name) {
        found.push(inner);
        if (stopAtMatch) {
          continue;
        }
      }
      if (inner.name !== boundary) {
        visit(inner);
      }
    }
  };
  visit(element);
  return found;
}

/**
 * Sums a counter across a step's threads.
 * @param threads The `RunTimeCountersPerThread` elements.
 * @param counter The counter's attribute.
 * @returns Returns the total, or undefined when no thread reports it.
 */
function sum(threads: readonly XmlElement[], counter: string): number | undefined {
  const values: readonly number[] = threads
    .map((thread: XmlElement): number => Number(thread.attributes.get(counter)))
    .filter((value: number): boolean => Number.isFinite(value));
  return values.length === 0
    ? undefined
    : values.reduce((total: number, value: number): number => total + value, 0);
}

/**
 * Lists an element's attributes as properties, less those the tree reads itself.
 * @param element The element.
 * @param mapped The attributes left out.
 * @returns Returns the properties.
 */
function scalarAttributes(
  element: XmlElement,
  mapped: ReadonlySet<string>,
): readonly PlanProperty[] {
  return [...element.attributes]
    .filter(([name, value]: [string, string]): boolean => !mapped.has(name) && value !== '')
    .map(([name, value]: [string, string]): PlanProperty => ({ name, value }));
}

/**
 * Sets a numeric field only when the attribute is a number.
 * @param name The field.
 * @param value The attribute's value.
 * @returns Returns the field, or nothing.
 */
function numberField(name: string, value: string | undefined): Record<string, number> {
  const number: number = value === undefined || value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(number) ? { [name]: number } : {};
}
