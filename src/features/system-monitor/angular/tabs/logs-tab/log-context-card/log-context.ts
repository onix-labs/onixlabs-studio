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
