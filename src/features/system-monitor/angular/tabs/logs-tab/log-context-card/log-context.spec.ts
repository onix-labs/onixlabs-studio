import { describe, expect, it } from 'vitest';
import { LogRecord } from '@shared/api/log-channels';
import { LogCode, logContext, logRaw } from './log-context';

/**
 * Builds a record with the given details.
 * @param details The details, if any.
 * @returns Returns the record.
 */
function record(details?: readonly string[]): LogRecord {
  return {
    id: 1,
    sessionId: 's',
    timestamp: '2026-11-14T00:26:42.137Z',
    severity: 'info',
    origin: 'main',
    source: 'default-project-systems',
    message: 'Seeded the project-system registry',
    ...(details === undefined ? {} : { details }),
  };
}

describe('logContext', () => {
  it('findsNoContext_whenNothingWasLoggedWithTheMessage', () => {
    expect(logContext(record())).toBeNull();
  });

  it('indentsOneObject_asJson', () => {
    const context: LogCode | null = logContext(record(['{"providerCount":7,"revision":69}']));

    expect(context).toEqual({
      text: '{\n  "providerCount": 7,\n  "revision": 69\n}',
      lang: 'json',
    });
  });

  it('showsSeveralObjects_asAnArray', () => {
    expect(logContext(record(['{"a":1}', '[2]']))?.text).toBe(
      '[\n  {\n    "a": 1\n  },\n  [\n    2\n  ]\n]',
    );
  });

  it('showsAStack_asText', () => {
    const context: LogCode | null = logContext(
      record(['Error: boom\n    at main (main.js:1:1)', '{"a":1}']),
    );

    expect(context?.lang).toBe('');
    expect(context?.text).toBe('Error: boom\n    at main (main.js:1:1)\n\n{"a":1}');
  });
});

describe('logRaw', () => {
  it('showsTheRecordAsStored', () => {
    expect(JSON.parse(logRaw(record(['x'])).text)).toEqual(record(['x']));
  });
});
