import { relativeDate } from '@shared/angular/services/source-control/relative-date';

/**
 * Pads a clock field to two digits.
 * @param value The field.
 * @returns Returns the padded field.
 */
function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Formats a measured duration, such as how long a test or a tool call took.
 * @param ms The duration in milliseconds.
 * @returns Returns the text, such as `12 ms`, `1.4 s` or `2 min 5 s`; empty when there is none.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return '';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)} s`
    : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/**
 * Formats a running time that ticks a second at a time, such as how long a task has run or how long
 * an agent has been quiet (#1419): whole seconds, no fractions to flicker.
 * @param ms The elapsed milliseconds.
 * @returns Returns the text, such as `45s`, `3m 12s` or `1h 04m`.
 */
export function formatElapsed(ms: number): string {
  const seconds: number = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${pad(seconds % 60)}s`;
  }
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/**
 * Formats the local clock time of a moment, as a transcript entry shows when it arrived (#1419).
 * @param epochMs The moment, in epoch milliseconds.
 * @returns Returns the time, such as `14:32:07`.
 */
export function clockTime(epochMs: number): string {
  const date: Date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Formats the local hour and minute of a moment, as a task says when it started (#1419).
 * @param epochMs The moment, in epoch milliseconds.
 * @returns Returns the time, such as `14:32`.
 */
export function clockMinutes(epochMs: number): string {
  const date: Date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Says when a moment was in full, for hovering a transcript entry's time (#1419): the local date and
 * time, then how long ago, phrased as the history phrases it.
 * @param epochMs The moment, in epoch milliseconds.
 * @param now The current time, in epoch milliseconds.
 * @returns Returns the text, such as `10 Nov 2026, 14:32:07 (4 minutes ago)`.
 */
export function fullTime(epochMs: number, now: number = Date.now()): string {
  const date: Date = new Date(epochMs);
  const when: string = date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ago: string = relativeDate(date.toISOString(), now);
  return ago.length === 0 ? when : `${when} (${ago})`;
}

/**
 * Says how long a background task has been running (#1419): when Studio saw it start and how long ago
 * that was, ticking with `now`. A task from before tasks were timed falls back to the provider's last
 * reported figure.
 * @param startedAt When Studio saw the task start, in epoch milliseconds, if it did.
 * @param reportedMs The provider's last reported running time.
 * @param now The current time, in epoch milliseconds.
 * @returns Returns the text, such as `Started 14:32 · 3m 12s`, or empty when nothing is known.
 */
export function taskTiming(startedAt: number | undefined, reportedMs: number, now: number): string {
  if (startedAt !== undefined) {
    return `Started ${clockMinutes(startedAt)} · ${formatElapsed(now - startedAt)}`;
  }
  return reportedMs > 0 ? formatElapsed(reportedMs) : '';
}
