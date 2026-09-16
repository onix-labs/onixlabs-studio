import { describe, expect, it } from 'vitest';
import { findXmlProblem, parseParserError, XmlProblem } from './xml-well-formedness';

describe('findXmlProblem', () => {
  it('wellFormed_orBlank_isNoProblem', () => {
    expect(findXmlProblem('<a><b/></a>')).toBeNull();
    expect(findXmlProblem('<?xml version="1.0"?>\n<root attr="1">text</root>')).toBeNull();
    expect(findXmlProblem('')).toBeNull();
    expect(findXmlProblem('   \n')).toBeNull();
  });

  it('malformed_reportsOneProblem', () => {
    const problem: XmlProblem | null = findXmlProblem('<a>\n  <b>\n</a>');
    expect(problem).not.toBeNull();
    expect(problem?.message.length).toBeGreaterThan(0);
    expect(problem?.line).toBeGreaterThanOrEqual(1);
    expect(problem?.column).toBeGreaterThanOrEqual(1);
  });

  it('parserThatThrows_isReportedAtTheStart', () => {
    const parser: DOMParser = {
      parseFromString: (): Document => {
        throw new Error('boom');
      },
    };
    expect(findXmlProblem('<a>', parser)).toEqual({ message: 'boom', line: 1, column: 1 });
  });
});

describe('parseParserError', () => {
  it('chromiumForm_readsTheLineColumnAndMessage', () => {
    const text: string =
      'This page contains the following errors:error on line 2 at column 5: Opening and ending tag mismatch: b line 2 and a\nBelow is a rendering of the page up to the first error.';
    expect(parseParserError(text)).toEqual({
      line: 2,
      column: 5,
      message: 'Opening and ending tag mismatch: b line 2 and a',
    });
  });

  it('prefixedForm_readsTheLineColumnAndMessage', () => {
    expect(parseParserError('3:7: unclosed tag')).toEqual({
      line: 3,
      column: 7,
      message: 'unclosed tag',
    });
  });

  it('unknownForm_isReportedAtTheStart_withTheFirstLine', () => {
    expect(parseParserError('something went wrong\nmore')).toEqual({
      line: 1,
      column: 1,
      message: 'something went wrong',
    });
    expect(parseParserError('')).toEqual({
      line: 1,
      column: 1,
      message: 'The XML is not well-formed.',
    });
  });
});
