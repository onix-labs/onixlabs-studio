import { describe, expect, it } from 'vitest';
import { LogRecord } from '@shared/api/log-channels';
import { describeOrigin, formatLogTime, formatLogTimestamp } from './log-format';

/**
 * Builds a record from the given origin.
 * @param origin Where it came from.
 * @param window The renderer window, if any.
 * @returns Returns the record.
 */
function record(origin: LogRecord['origin'], window?: string): LogRecord {
  return {
    id: 1,
    sessionId: 's',
    timestamp: 't',
    severity: 'info',
    origin,
    source: 'Test',
    message: 'm',
    ...(window === undefined ? {} : { window }),
  };
}

describe('log format', () => {
  it('formatLogTime_readsToTheMillisecond_inLocalTime', () => {
    const at: Date = new Date(2026, 10, 14, 0, 26, 42, 137);

    expect(formatLogTime(at.toISOString())).toBe('00:26:42.137');
    expect(formatLogTime('not a time')).toBe('not a time');
  });

  it('formatLogTimestamp_putsTheDateBeforeTheTime', () => {
    const at: Date = new Date(2026, 10, 14, 9, 5, 7, 4);

    expect(formatLogTimestamp(at.toISOString())).toBe(`${at.toLocaleDateString()}, 09:05:07.004`);
  });

  it('describeOrigin_namesTheMainProcess_orTheRendererAndItsWindow', () => {
    expect(describeOrigin(record('main'))).toBe('Main process');
    expect(describeOrigin(record('renderer', 'window-3'))).toBe('Renderer · window-3');
    expect(describeOrigin(record('renderer'))).toBe('Renderer');
  });
});
