import { describe, expect, it } from 'vitest';
import { indentJson } from './indent-json';

describe('indentJson', () => {
  it.each([
    ['{"a":1}'],
    ['[]'],
    ['{}'],
    ['[1,[2,[3,{}]],{"b":[]}]'],
    ['{"a":{"b":{"c":null}},"d":[true,false]}'],
    ['"text"'],
    ['12'],
    ['null'],
  ])('indentJson_layoutMatchesJsonStringify_%s', (json: string) => {
    expect(indentJson(json)).toBe(JSON.stringify(JSON.parse(json), null, 2));
  });

  it('indentJson_keepsAnIntegerTooLargeForADouble', () => {
    expect(indentJson('{"id":12345678901234567890}')).toBe('{\n  "id": 12345678901234567890\n}');
  });

  it('indentJson_keepsANumberAsItWasWritten', () => {
    expect(indentJson('[1.10,1e3,-0]')).toBe('[\n  1.10,\n  1e3,\n  -0\n]');
  });

  it('indentJson_keepsKeyOrderAndRepeatedKeys', () => {
    expect(indentJson('{"2":1,"1":2,"1":3}')).toBe('{\n  "2": 1,\n  "1": 2,\n  "1": 3\n}');
  });

  it('indentJson_leavesStructureInsideStringsAlone', () => {
    expect(indentJson('{"a{,:":"b\\"}, [ c"}')).toBe('{\n  "a{,:": "b\\"}, [ c"\n}');
  });

  it('indentJson_endsAStringAfterAnEscapedBackslash', () => {
    expect(indentJson('["a\\\\",1]')).toBe('[\n  "a\\\\",\n  1\n]');
  });

  it('indentJson_replacesTheWhitespaceItWasGiven', () => {
    expect(indentJson(' {\r\n\t"a" :  [ ] ,\n "b":{ }\n}\n')).toBe('{\n  "a": [],\n  "b": {}\n}');
  });

  it('indentJson_keepsUnicodeAndEscapesVerbatim', () => {
    expect(indentJson('["é\\u00e9😀"]')).toBe('[\n  "é\\u00e9😀"\n]');
  });

  it('indentJson_ofALargeDocument_isStillValidAndComplete', () => {
    const rows: number[] = Array.from({ length: 20000 }, (_: unknown, row: number): number => row);
    const json: string = JSON.stringify({ rows });

    expect(JSON.parse(indentJson(json))).toEqual({ rows });
  });
});
