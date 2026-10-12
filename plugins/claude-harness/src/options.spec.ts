import { describe, expect, it } from 'vitest';
import { parseQuestions } from './options';

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
