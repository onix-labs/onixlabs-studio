import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import type { SkillImportDraft } from '@shared/api/skill-import-channels';
import { readAnswer, SkillAssistResult } from './skill-assist';

describe('readAnswer (#1263)', () => {
  const fallback: SkillImportDraft = {
    name: 'acid',
    description: 'Drafted.',
    scope: GLOBAL_SCOPE,
    technologies: [],
    enabled: false,
    body: '# ACID\n',
  };

  it('readAnswer_whenSkillFile_readsItsFields', () => {
    const result: SkillAssistResult = readAnswer(
      [
        '```markdown',
        '---',
        'name: acid-transactions',
        'description: "Use when designing transactions: atomicity and isolation."',
        'languages: [typescript, not-a-real-tag]',
        '---',
        '# ACID',
        '',
        'Body.',
        '```',
      ].join('\n'),
      fallback,
    );

    expect(result).toEqual({
      kind: 'draft',
      draft: {
        name: 'acid-transactions',
        description: 'Use when designing transactions: atomicity and isolation.',
        scope: { surfaces: [], languages: ['typescript'] },
        technologies: [],
        enabled: false,
        body: '# ACID\n\nBody.',
      },
    });
  });

  it('readAnswer_whenNameInvalid_keepsTheDraftName', () => {
    const result: SkillAssistResult = readAnswer(
      '---\nname: Not Valid\ndescription: d\n---\nBody',
      fallback,
    );

    expect(result.kind === 'draft' && result.draft.name).toBe('acid');
  });

  it('readAnswer_whenRefused_saysWhy', () => {
    expect(readAnswer('NOT A SKILL: it is an index of other files', fallback)).toEqual({
      kind: 'not-a-skill',
      reason: 'it is an index of other files',
    });
  });

  it('readAnswer_whenNoSkillFile_isAnError', () => {
    expect(readAnswer('Sure! Here is a better version.', fallback).kind).toBe('error');
  });

  it('readAnswer_whenDescriptionTooLong_clipsIt', () => {
    const result: SkillAssistResult = readAnswer(
      `---\nname: acid\ndescription: "${'word '.repeat(400)}"\n---\nBody`,
      fallback,
    );

    expect(result.kind === 'draft' && result.draft.description.length).toBeLessThanOrEqual(1024);
  });
});
