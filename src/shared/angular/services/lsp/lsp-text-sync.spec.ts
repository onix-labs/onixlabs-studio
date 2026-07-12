import { LspContentEdit, LspSyncPosition, minimalReplaceEdit, positionAt } from './lsp-text-sync';

/**
 * Converts a zero-based position back into a character offset, mirroring how a server locates a
 * range within the text it holds (lines terminated by `\n`, `\r\n`, or a lone `\r`).
 * @param text The document text.
 * @param position The position to locate.
 * @returns Returns the character offset of the position.
 */
function offsetOf(text: string, position: LspSyncPosition): number {
  let line: number = 0;
  let index: number = 0;
  while (line < position.line && index < text.length) {
    const char: string = text.charAt(index);
    if (char === '\n' || (char === '\r' && text.charAt(index + 1) !== '\n')) {
      line += 1;
    }
    index += 1;
  }
  return index + position.character;
}

/**
 * Applies a single ranged edit to a document the way a server would.
 * @param text The previous document text.
 * @param edit The ranged edit.
 * @returns Returns the edited text.
 */
function apply(text: string, edit: LspContentEdit): string {
  const start: number = offsetOf(text, edit.range.start);
  const end: number = offsetOf(text, edit.range.end);
  return text.slice(0, start) + edit.text + text.slice(end);
}

describe('minimalReplaceEdit', () => {
  it('identicalTexts_returnsNull', () => {
    expect(minimalReplaceEdit('const a = 1;', 'const a = 1;')).toBeNull();
  });

  it('insertion_replacesAnEmptyRangeAtTheInsertionPoint', () => {
    const edit: LspContentEdit | null = minimalReplaceEdit('const a = 1;', 'const ab = 1;');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } },
      text: 'b',
    });
  });

  it('deletion_replacesTheDeletedRangeWithEmptyText', () => {
    const edit: LspContentEdit | null = minimalReplaceEdit('const abc = 1;', 'const ac = 1;');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 7 }, end: { line: 0, character: 8 } },
      text: '',
    });
  });

  it('append_replacesAnEmptyRangeAtTheEnd', () => {
    const edit: LspContentEdit | null = minimalReplaceEdit('line one', 'line one two');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 8 }, end: { line: 0, character: 8 } },
      text: ' two',
    });
  });

  it('prepend_replacesAnEmptyRangeAtTheStart', () => {
    const edit: LspContentEdit | null = minimalReplaceEdit('world', 'hello world');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      text: 'hello ',
    });
  });

  it('multiLineEdit_positionsTheRangeOnTheChangedLine', () => {
    const oldText: string = 'class A {\n  int x;\n}\n';
    const newText: string = 'class A {\n  int xy;\n}\n';
    const edit: LspContentEdit | null = minimalReplaceEdit(oldText, newText);

    expect(edit).toEqual({
      range: { start: { line: 1, character: 7 }, end: { line: 1, character: 7 } },
      text: 'y',
    });
  });

  it('disjointTexts_degeneratesToAWholeDocumentReplace', () => {
    const edit: LspContentEdit | null = minimalReplaceEdit('abc\ndef', 'XYZ');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 3 } },
      text: 'XYZ',
    });
  });

  it('editBetweenRepeatedText_staysMinimalAndNonOverlapping', () => {
    // Prefix and suffix share 'aa'; the scan must not let them overlap.
    const edit: LspContentEdit | null = minimalReplaceEdit('aaaa', 'aaa');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } },
      text: '',
    });
  });

  it('emptyToContent_replacesTheEmptyDocument', () => {
    const edit: LspContentEdit | null = minimalReplaceEdit('', 'hello');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      text: 'hello',
    });
  });

  it('contentToEmpty_deletesTheWholeDocument', () => {
    const edit: LspContentEdit | null = minimalReplaceEdit('a\nb', '');

    expect(edit).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } },
      text: '',
    });
  });

  it('crlfDocument_neverSplitsATerminatorPair', () => {
    // The differing span sits right after a \r\n pair; the boundary must not land between \r and \n.
    const edit: LspContentEdit | null = minimalReplaceEdit('one\r\ntwo', 'one\r\nTWO');

    expect(edit).toEqual({
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
      text: 'TWO',
    });
  });

  it('appliedEdit_reproducesTheNewText_acrossTrickyCases', () => {
    const cases: readonly [string, string][] = [
      ['a\n', 'a\r\n'],
      ['one\r\ntwo\r\nthree', 'one\r\n2\r\nthree'],
      ['x\r\ny', 'x\ny'],
      ['aaa\naaa\naaa', 'aaa\naa\naaa'],
      ['same middle text', 'other middle blob'],
      ['tail\r\n', 'tail\r\nmore\r\n'],
    ];
    for (const [oldText, newText] of cases) {
      const edit: LspContentEdit | null = minimalReplaceEdit(oldText, newText);
      expect(edit).not.toBeNull();
      expect(apply(oldText, edit!)).toBe(newText);
    }
  });
});

describe('positionAt', () => {
  it('countsLinesAcrossLfCrLfAndLoneCr', () => {
    const text: string = 'a\nb\r\nc\rd';

    expect(positionAt(text, 0)).toEqual({ line: 0, character: 0 });
    expect(positionAt(text, 2)).toEqual({ line: 1, character: 0 });
    expect(positionAt(text, 5)).toEqual({ line: 2, character: 0 });
    expect(positionAt(text, 7)).toEqual({ line: 3, character: 0 });
    expect(positionAt(text, 8)).toEqual({ line: 3, character: 1 });
  });

  it('clampsOffsetsPastTheEnd', () => {
    expect(positionAt('ab', 99)).toEqual({ line: 0, character: 2 });
  });
});
