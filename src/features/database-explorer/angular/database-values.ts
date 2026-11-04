import { DatabaseValue } from '@shared/api/database-engine-protocol';

/**
 * How a cell reads in the grid: its text, and what kind of value it is, so NULL can be muted, numbers
 * right-aligned and graph values marked.
 */
export interface CellText {
  readonly text: string;
  readonly kind: 'null' | 'number' | 'text' | 'boolean' | 'graph' | 'other';
}

/**
 * How the grid shows a value, from the user's settings. Display only: an export takes the values as
 * they were sent.
 */
export interface CellFormat {
  /**
   * Gets what a NULL reads as.
   */
  readonly nullText?: string;

  /**
   * Gets whether numbers, dates and times read in the machine's local format.
   */
  readonly local?: boolean;
}

/**
 * Reads a date or time in the machine's local format, leaving what `Date` cannot read (a time of day,
 * an interval) as it was sent.
 * @param text The value as it was sent.
 * @returns Returns how it reads.
 */
function localTemporal(text: string): string {
  const time: number = Date.parse(text);
  return Number.isNaN(time) ? text : new Date(time).toLocaleString();
}

/**
 * Formats a typed cell for the grid.
 * @param value The cell.
 * @param format How the user has it shown.
 * @returns Returns how it reads.
 */
export function cellText(value: DatabaseValue, format?: CellFormat): CellText {
  if (value === null) {
    return { text: format?.nullText ?? 'NULL', kind: 'null' };
  }
  if (typeof value === 'number') {
    return {
      text: format?.local === true ? value.toLocaleString() : String(value),
      kind: 'number',
    };
  }
  if (typeof value === 'boolean') {
    return { text: value ? 'true' : 'false', kind: 'boolean' };
  }
  if (typeof value === 'string') {
    return { text: value, kind: 'text' };
  }
  switch (value.type) {
    case 'bigint':
      return {
        text: format?.local === true ? BigInt(value.value).toLocaleString() : value.value,
        kind: 'number',
      };
    case 'bytes':
      return {
        text: `0x${value.preview}${value.size > 16 ? '…' : ''} (${value.size} bytes)`,
        kind: 'other',
      };
    case 'temporal':
      return {
        text: format?.local === true ? localTemporal(value.value) : value.value,
        kind: 'text',
      };
    case 'json':
      return { text: JSON.stringify(value.value), kind: 'other' };
    case 'list':
      return {
        text: `[${value.items.map((item: DatabaseValue): string => cellText(item).text).join(', ')}]`,
        kind: 'other',
      };
    case 'map':
      return { text: JSON.stringify(plainValue(value)), kind: 'other' };
    case 'node':
      return {
        text: `(${value.labels.map((label: string): string => `:${label}`).join('')} ${JSON.stringify(plainValue(value.properties as unknown as DatabaseValue))})`,
        kind: 'graph',
      };
    case 'relationship':
      return {
        text: `[:${value.relationshipType} ${JSON.stringify(plainValue(value.properties as unknown as DatabaseValue))}]`,
        kind: 'graph',
      };
    case 'path':
      return {
        text: `path of ${value.relationships.length} relationship${value.relationships.length === 1 ? '' : 's'}`,
        kind: 'graph',
      };
  }
}

/**
 * Converts a typed cell back into plain JSON, for the Raw view and for copying.
 * @param value The cell.
 * @returns Returns plain JSON.
 */
export function plainValue(value: DatabaseValue): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (!('type' in value) || typeof value.type !== 'string') {
    // A bare property map (a node's properties).
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, DatabaseValue>>).map(
        ([key, item]: [string, DatabaseValue]): [string, unknown] => [key, plainValue(item)],
      ),
    );
  }
  switch (value.type) {
    case 'bigint':
    case 'temporal':
      return value.value;
    case 'bytes':
      return `0x${value.preview}${value.size > 16 ? '…' : ''}`;
    case 'json':
      return value.value;
    case 'list':
      return value.items.map(plainValue);
    case 'map':
      return plainValue(value.entries as unknown as DatabaseValue);
    case 'node':
      return {
        identity: value.id,
        labels: value.labels,
        properties: plainValue(value.properties as unknown as DatabaseValue),
      };
    case 'relationship':
      return {
        identity: value.id,
        type: value.relationshipType,
        start: value.start,
        end: value.end,
        properties: plainValue(value.properties as unknown as DatabaseValue),
      };
    case 'path':
      return {
        nodes: value.nodes.map(plainValue),
        relationships: value.relationships.map(plainValue),
      };
  }
}

/**
 * Determines whether a cell holds a graph value anywhere within it, so the Graph view is offered.
 * @param value The cell.
 * @returns Returns true for a node, relationship or path, or a list holding one.
 */
export function holdsGraph(value: DatabaseValue): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (value.type === 'node' || value.type === 'relationship' || value.type === 'path') {
    return true;
  }
  return value.type === 'list' && value.items.some(holdsGraph);
}
