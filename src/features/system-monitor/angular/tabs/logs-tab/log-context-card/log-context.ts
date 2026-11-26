import { LogRecord } from '@shared/api/log-channels';

/**
 * Describes text to show as code: the text and the language it is highlighted as.
 */
export interface LogCode {
  /**
   * Gets the text.
   */
  readonly text: string;

  /**
   * Gets the language it is highlighted as (`json`), or the empty string for plain text.
   */
  readonly lang: string;
}

/**
 * Parses one serialised detail as JSON, or reports that it is not JSON (a string detail, an error's
 * stack).
 * @param detail The detail.
 * @returns Returns the parsed value, or undefined when it is not JSON.
 */
function parseDetail(detail: string): unknown {
  try {
    const parsed: unknown = JSON.parse(detail);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Works out a record's context: the values logged with its message. When every one is a JSON object or
 * array, they are shown as JSON, indented (one value as itself, several as an array); otherwise as
 * text, one after another (an error's stack keeps its lines).
 * @param record The record.
 * @returns Returns the context, or null when nothing was logged with the message.
 */
export function logContext(record: LogRecord): LogCode | null {
  const details: readonly string[] = record.details ?? [];
  if (details.length === 0) {
    return null;
  }
  const parsed: readonly unknown[] = details.map(parseDetail);
  if (parsed.every((value: unknown): boolean => value !== undefined)) {
    return {
      text: JSON.stringify(parsed.length === 1 ? parsed[0] : parsed, null, 2),
      lang: 'json',
    };
  }
  return { text: details.join('\n\n'), lang: '' };
}

/**
 * Shows a record as it is stored: its JSON, indented.
 * @param record The record.
 * @returns Returns the record's JSON.
 */
export function logRaw(record: LogRecord): LogCode {
  return { text: JSON.stringify(record, null, 2), lang: 'json' };
}

/**
 * Identifies what a piece of a shown line is, for its colour: a JSON key, string, number or literal
 * (`true`, `false`, `null`), punctuation, or plain text.
 */
export type CodeTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punctuation' | 'text';

/**
 * Describes one piece of a shown line.
 */
export interface CodeToken {
  /**
   * Gets what the piece is.
   */
  readonly kind: CodeTokenKind;

  /**
   * Gets its text.
   */
  readonly text: string;
}

/**
 * The pieces of a line of JSON: a string (a key when a colon follows it), a number, a literal,
 * punctuation, a run of spaces, or any other character.
 */
const JSON_TOKEN: RegExp =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|(.)/g;

/**
 * Splits a line of JSON into its pieces.
 * @param line The line.
 * @returns Returns its pieces, in order.
 */
function jsonTokens(line: string): readonly CodeToken[] {
  const tokens: CodeToken[] = [];
  for (const match of line.matchAll(JSON_TOKEN)) {
    const [, string, colon, number, literal, punctuation, space, other] = match;
    if (string !== undefined) {
      tokens.push({ kind: colon === undefined ? 'string' : 'key', text: string });
      if (colon !== undefined) {
        tokens.push({ kind: 'punctuation', text: colon });
      }
    } else if (number !== undefined) {
      tokens.push({ kind: 'number', text: number });
    } else if (literal !== undefined) {
      tokens.push({ kind: 'literal', text: literal });
    } else if (punctuation !== undefined) {
      tokens.push({ kind: 'punctuation', text: punctuation });
    } else {
      tokens.push({ kind: 'text', text: space ?? other ?? '' });
    }
  }
  return tokens;
}

/**
 * Splits shown text into lines of pieces for display: JSON coloured by what each piece is, anything
 * else as plain text.
 * @param code The text and its language.
 * @returns Returns each line's pieces.
 */
export function codeLines(code: LogCode): readonly (readonly CodeToken[])[] {
  return code.text
    .split('\n')
    .map((line: string): readonly CodeToken[] =>
      code.lang === 'json' ? jsonTokens(line) : [{ kind: 'text', text: line }],
    );
}
