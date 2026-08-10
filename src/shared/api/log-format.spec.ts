import { describe, expect, it } from 'vitest';
import { appendDetails, serializeDetail } from './log-format';

describe('serializeDetail', () => {
  it('passesStringsThrough', () => {
    expect(serializeDetail('hello')).toBe('hello');
  });

  it('keepsAnErrorStack', () => {
    const error: Error = new Error('boom');
    expect(serializeDetail(error)).toContain('boom');
    expect(serializeDetail(error)).toBe(error.stack);
  });

  it('jsonEncodesObjects', () => {
    expect(serializeDetail({ a: 1 })).toBe('{"a":1}');
  });

  it('fallsBackToStringForCircularStructures', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(serializeDetail(circular)).toBe('[object Object]');
  });
});

describe('appendDetails', () => {
  it('returnsTheMessageUnchangedWithNoDetails', () => {
    expect(appendDetails('done', [])).toBe('done');
  });

  it('appendsSerialisedDetails', () => {
    expect(appendDetails('failed', ['at step', { code: 2 }])).toBe('failed at step {"code":2}');
  });
});
