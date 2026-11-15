import { describe, expect, it } from 'vitest';
import {
  appendDetails,
  fullMessage,
  MAX_LOG_DETAILS,
  sanitizeDetails,
  serializeDetail,
  serializeDetails,
} from './log-format';

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

describe('serializeDetails', () => {
  it('keepsEachDetail_orNoneWhenThereAreNone', () => {
    expect(serializeDetails([])).toBeUndefined();
    expect(serializeDetails(['a', { b: 1 }])).toEqual(['a', '{"b":1}']);
  });
});

describe('sanitizeDetails', () => {
  it('keepsOnlyStrings_capped', () => {
    expect(sanitizeDetails('nope')).toBeUndefined();
    expect(sanitizeDetails([1, 'a'])).toEqual(['a']);
    expect(sanitizeDetails(Array.from({ length: 20 }, (): string => 'x'))).toHaveLength(
      MAX_LOG_DETAILS,
    );
  });
});

describe('fullMessage', () => {
  it('appendsTheDetails', () => {
    expect(fullMessage({ message: 'seeded', details: ['{"a":1}'] })).toBe('seeded {"a":1}');
    expect(fullMessage({ message: 'seeded' })).toBe('seeded');
  });
});
