import { describe, expect, it } from 'vitest';
import { parseQuestions, proposedChange } from './options';

describe('parseQuestions', () => {
  it('asksForSeveralChoices_onlyForAMultiSelectQuestion', () => {
    // An AND question drawn as radios reads as an OR: the user can only pick one of things they want
    // several of. `multiSelect` is what tells the two apart.
    const parsed: ReturnType<typeof parseQuestions> = parseQuestions({
      questions: [
        {
          question: 'Which checks?',
          options: [{ label: 'Lint' }, { label: 'Tests' }],
          multiSelect: true,
        },
        { question: 'Which base?', options: [{ label: 'main' }], multiSelect: false },
        { question: 'Which name?', options: [] },
      ],
    });

    expect(parsed.map((question: { selection: string }): string => question.selection)).toEqual([
      'multiple',
      'single',
      'single',
    ]);
  });
});

describe('proposedChange', () => {
  it('sendsAWritesWholeContent', () => {
    expect(proposedChange('Write', { file_path: '/repo/a.ts', content: 'export {};\n' })).toEqual({
      path: '/repo/a.ts',
      content: 'export {};\n',
    });
  });

  it('sendsAnEditsReplacement_inStudiosFieldNames', () => {
    expect(
      proposedChange('Edit', {
        file_path: '/repo/a.ts',
        old_string: 'a',
        new_string: 'b',
        replace_all: true,
      }),
    ).toEqual({ path: '/repo/a.ts', edits: [{ oldText: 'a', newText: 'b', replaceAll: true }] });
  });

  it('sendsAMultiEditsReplacementsInOrder', () => {
    expect(
      proposedChange('MultiEdit', {
        file_path: '/repo/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      })?.edits,
    ).toEqual([
      { oldText: 'a', newText: 'b' },
      { oldText: 'c', newText: 'd' },
    ]);
  });

  it('proposesNothing_forAnyOtherToolOrAMalformedInput', () => {
    expect(proposedChange('Bash', { command: 'ls' })).toBeUndefined();
    expect(proposedChange('Edit', { file_path: '/repo/a.ts', old_string: 1 })).toBeUndefined();
    expect(proposedChange('Write', { content: 'no path' })).toBeUndefined();
  });

  it('proposesNothing_forAChangeTooLongToSendWithAPrompt', () => {
    expect(
      proposedChange('Write', { file_path: '/repo/big.ts', content: 'x'.repeat(600 * 1024) }),
    ).toBeUndefined();
  });
});
