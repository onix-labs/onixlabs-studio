/**
 * One batch of a T-SQL script: the text between two `GO` lines, which SQL Server runs as one unit.
 */
export interface SqlServerBatch {
  /**
   * Gets the batch's text, without its `GO` line.
   */
  readonly text: string;

  /**
   * Gets the 1-based line the batch's first line sits on, in the caller's numbering.
   */
  readonly line: number;

  /**
   * Gets how many times to run it: the count after `GO`, as `GO 5` asks; 1 otherwise.
   */
  readonly repeat: number;
}

/**
 * Matches a `GO` line as SSMS and `sqlcmd` read one: `GO` alone on its line, any case, optionally with
 * a count and a trailing line comment.
 */
const GO_LINE: RegExp = /^[ \t]*go(?:[ \t]+(\d+))?[ \t]*(?:--.*)?$/i;

/**
 * The most times a `GO n` runs its batch, bounding a typo like `GO 1000000`.
 */
const MAX_REPEAT: number = 1000;

/**
 * Splits a T-SQL script into batches at its `GO` lines. `GO` is not T-SQL but the client's separator,
 * so it is only one where it stands alone on a line outside a string, a bracketed or quoted name, and
 * a comment. A batch holding only whitespace and comments is dropped, as SSMS sends nothing for one.
 * @param script The script.
 * @param firstLine The line the script starts on, in the caller's numbering.
 * @returns Returns the batches, in order.
 */
export function splitBatches(script: string, firstLine: number = 1): readonly SqlServerBatch[] {
  const lines: readonly string[] = script.split(/\r?\n/);
  const batches: SqlServerBatch[] = [];
  let state: ScanState = 'code';
  let blockDepth: number = 0;
  let start: number = 0;
  const push: (end: number, repeat: number) => void = (end: number, repeat: number): void => {
    const text: string = lines.slice(start, end).join('\n');
    if (hasCode(text)) {
      batches.push({ text, line: firstLine + start, repeat });
    }
  };
  for (let index: number = 0; index < lines.length; index += 1) {
    const line: string = lines[index];
    const go: RegExpExecArray | null = state === 'code' ? GO_LINE.exec(line) : null;
    if (go !== null) {
      push(index, Math.min(Math.max(Number(go[1] ?? '1'), 1), MAX_REPEAT));
      start = index + 1;
      continue;
    }
    ({ state, blockDepth } = scanLine(line, state, blockDepth));
  }
  push(lines.length, 1);
  return batches;
}

/**
 * Where a scan stands at the end of a line: in code, or inside something that runs on to the next.
 */
type ScanState = 'code' | 'string' | 'bracket' | 'quoted' | 'block';

/**
 * Scans one line for what carries over to the next: an open string, bracketed or quoted name, or block
 * comment (which T-SQL nests). A line comment ends with its line.
 * @param line The line.
 * @param state Where the scan stood at the line's start.
 * @param blockDepth How deep in block comments it stood.
 * @returns Returns where it stands at the line's end.
 */
function scanLine(
  line: string,
  state: ScanState,
  blockDepth: number,
): { state: ScanState; blockDepth: number } {
  let index: number = 0;
  while (index < line.length) {
    const char: string = line[index];
    const next: string = line[index + 1] ?? '';
    switch (state) {
      case 'block':
        if (char === '/' && next === '*') {
          blockDepth += 1;
          index += 1;
        } else if (char === '*' && next === '/') {
          blockDepth -= 1;
          index += 1;
          if (blockDepth === 0) {
            state = 'code';
          }
        }
        break;
      case 'string':
      case 'bracket':
      case 'quoted': {
        const close: string = state === 'string' ? "'" : state === 'bracket' ? ']' : '"';
        if (char === close) {
          // A doubled closer is an escaped one, not the end.
          if (next === close) {
            index += 1;
          } else {
            state = 'code';
          }
        }
        break;
      }
      default:
        if (char === '-' && next === '-') {
          return { state, blockDepth };
        }
        if (char === '/' && next === '*') {
          state = 'block';
          blockDepth = 1;
          index += 1;
        } else if (char === "'") {
          state = 'string';
        } else if (char === '[') {
          state = 'bracket';
        } else if (char === '"') {
          state = 'quoted';
        }
        break;
    }
    index += 1;
  }
  return { state, blockDepth };
}

/**
 * Determines whether a batch holds anything but whitespace and comments.
 * @param text The batch.
 * @returns Returns true when there is something to run.
 */
function hasCode(text: string): boolean {
  return (
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim().length > 0
  );
}
