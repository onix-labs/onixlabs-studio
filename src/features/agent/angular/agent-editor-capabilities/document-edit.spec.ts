import { EditOutcome, resolveEdit, resolveInsert } from './document-edit';

describe('resolveEdit', () => {
  const source: string = 'const a = 1;\nconst b = 2;\nconst c = a + b;\n';

  it('uniqueMatch_replacesTheOccurrenceAndReportsTheRange', () => {
    const outcome: EditOutcome = resolveEdit(source, 'const b = 2;', 'const b = 20;', false);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe('const a = 1;\nconst b = 20;\nconst c = a + b;\n');
    expect(outcome.range).toEqual({ start: 13, length: 12, insert: 'const b = 20;' });
  });

  it('emptyNewString_deletesTheMatch', () => {
    const outcome: EditOutcome = resolveEdit(source, 'const b = 2;\n', '', false);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe('const a = 1;\nconst c = a + b;\n');
    expect(outcome.detail).toContain('deleted');
  });

  it('missingAnchor_failsWithReadAgainGuidance', () => {
    const outcome: EditOutcome = resolveEdit(source, 'const z = 9;', 'x', false);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toBe(source);
    expect(outcome.detail).toContain('not found');
  });

  it('ambiguousAnchor_failsWithTheMatchCount', () => {
    const outcome: EditOutcome = resolveEdit(source, 'const', 'let', false);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('3 places');
  });

  it('replaceAll_replacesEveryOccurrence', () => {
    const outcome: EditOutcome = resolveEdit(source, 'const', 'let', true);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe('let a = 1;\nlet b = 2;\nlet c = a + b;\n');
    expect(outcome.range).toBeUndefined();
    expect(outcome.detail).toContain('3 occurrences');
  });

  it('emptyOldString_fails', () => {
    expect(resolveEdit(source, '', 'x', false).ok).toBe(false);
  });

  it('identicalStrings_fails', () => {
    expect(resolveEdit(source, 'const a', 'const a', false).ok).toBe(false);
  });

  it('overlappingOccurrences_countNonOverlapping', () => {
    const outcome: EditOutcome = resolveEdit('aaaa', 'aa', 'b', true);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe('bb');
  });
});

describe('resolveInsert', () => {
  const source: string = '# Title\n\nBody paragraph.\n';

  it('afterAnchor_insertsAfterTheMatch', () => {
    const outcome: EditOutcome = resolveInsert(
      source,
      '\n\nNew section.',
      'after',
      'Body paragraph.',
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe('# Title\n\nBody paragraph.\n\nNew section.\n');
    expect(outcome.range).toEqual({ start: 24, length: 0, insert: '\n\nNew section.' });
  });

  it('beforeAnchor_insertsBeforeTheMatch', () => {
    const outcome: EditOutcome = resolveInsert(source, 'Intro. ', 'before', 'Body paragraph.');
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe('# Title\n\nIntro. Body paragraph.\n');
  });

  it('start_insertsAtTheDocumentStart', () => {
    const outcome: EditOutcome = resolveInsert(source, '<!-- draft -->\n', 'start');
    expect(outcome.ok).toBe(true);
    expect(outcome.text.startsWith('<!-- draft -->\n# Title')).toBe(true);
  });

  it('end_insertsAtTheDocumentEnd', () => {
    const outcome: EditOutcome = resolveInsert(source, 'Footer.\n', 'end');
    expect(outcome.ok).toBe(true);
    expect(outcome.text.endsWith('Body paragraph.\nFooter.\n')).toBe(true);
  });

  it('relativePlacementWithoutAnchor_fails', () => {
    const outcome: EditOutcome = resolveInsert(source, 'x', 'after');
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('anchor is required');
  });

  it('missingAnchor_fails', () => {
    expect(resolveInsert(source, 'x', 'after', 'nope').ok).toBe(false);
  });

  it('ambiguousAnchor_fails', () => {
    const outcome: EditOutcome = resolveInsert('a\na\n', 'x', 'after', 'a');
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('2 places');
  });

  it('emptyText_fails', () => {
    expect(resolveInsert(source, '', 'end').ok).toBe(false);
  });
});
