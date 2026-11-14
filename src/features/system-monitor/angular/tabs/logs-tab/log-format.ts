import { ChipTone } from '@shared/angular/components/chip/chip';
import { LogRecord, Severity } from '@shared/api/log-channels';

/**
 * The chip tone each severity is labelled in: trace quiet, then rising to danger for an error.
 */
export const SEVERITY_TONES: Readonly<Record<Severity, ChipTone>> = {
  trace: 'neutral',
  debug: 'info',
  info: 'accent',
  warning: 'warning',
  error: 'danger',
};

/**
 * Pads a number with leading zeros.
 * @param value The number.
 * @param length The digits wanted.
 * @returns Returns the padded number.
 */
function pad(value: number, length: number = 2): string {
  return `${value}`.padStart(length, '0');
}

/**
 * Formats a record's time to the millisecond, in local time (`00:26:42.137`), as a log reads it.
 * @param timestamp The ISO-8601 timestamp.
 * @returns Returns the time, or the timestamp itself when it does not parse.
 */
export function formatLogTime(timestamp: string): string {
  const date: Date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * Formats a record's date and time to the millisecond, in local time (`14/11/2026, 00:26:42.137`).
 * @param timestamp The ISO-8601 timestamp.
 * @returns Returns the date and time, or the timestamp itself when it does not parse.
 */
export function formatLogTimestamp(timestamp: string): string {
  const date: Date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return `${date.toLocaleDateString()}, ${formatLogTime(timestamp)}`;
}

/**
 * Describes where a record came from: the main process, or a renderer and its window.
 * @param record The record.
 * @returns Returns the description (`Main process`, `Renderer · window-3`).
 */
export function describeOrigin(record: LogRecord): string {
  if (record.origin === 'main') {
    return 'Main process';
  }
  return record.window ? `Renderer · ${record.window}` : 'Renderer';
}
