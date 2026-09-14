import { describe, expect, it } from 'vitest';
import { LOAD_SKILL } from '@shared/api/ai-types';
import type { AgentRunContext, OfferedSkill } from './agent-provider';
import { composeUserPrompt, skillsAppendix, withSystemPromptExtra } from './prompt-layers';

/**
 * Builds a run context carrying only the prompt layers.
 * @param overrides Fields to set.
 * @returns Returns the context.
 */
function contextFor(overrides: Partial<Record<string, unknown>> = {}): AgentRunContext {
  return {
    prompt: 'do the thing',
    systemPromptExtra: '',
    userPromptExtra: '',
    skills: [],
    ...overrides,
  } as unknown as AgentRunContext;
}

/**
 * Builds an offered skill.
 * @param name The name.
 * @param description The description.
 * @returns Returns the skill.
 */
function skill(name: string, description: string): OfferedSkill {
  return { name, description, load: (): Promise<null> => Promise.resolve(null) };
}

describe('withSystemPromptExtra', () => {
  it('withSystemPromptExtra_whenNone_returnsInstructionsUnchanged', () => {
    expect(withSystemPromptExtra('base', contextFor({ systemPromptExtra: '  ' }))).toBe('base');
  });

  it('withSystemPromptExtra_whenPresent_appendsBeneathStudiosOwn', () => {
    const result: string = withSystemPromptExtra(
      'base',
      contextFor({ systemPromptExtra: '### Style\nExplicit types.' }),
    );

    expect(result.startsWith('base\n\n')).toBe(true);
    expect(result.endsWith('### Style\nExplicit types.')).toBe(true);
    expect(result).toContain('standing instructions');
  });
});

describe('composeUserPrompt', () => {
  it('composeUserPrompt_whenNone_returnsThePromptUnchanged', () => {
    expect(composeUserPrompt(contextFor())).toBe('do the thing');
  });

  it('composeUserPrompt_whenPresent_placesTheStandingTextBeneathTheMessage', () => {
    const result: string = composeUserPrompt(contextFor({ userPromptExtra: 'British English.' }));

    expect(result.startsWith('do the thing\n\n---\n')).toBe(true);
    expect(result.endsWith('British English.')).toBe(true);
  });
});

describe('skillsAppendix', () => {
  it('skillsAppendix_whenNoSkills_isEmpty', () => {
    expect(skillsAppendix(contextFor())).toBe('');
  });

  it('skillsAppendix_listsEachSkillAndNamesTheTool', () => {
    const result: string = skillsAppendix(
      contextFor({
        skills: [skill('csharp-style', 'C# house style.'), skill('commits', 'Commits.')],
      }),
    );

    expect(result).toContain('- csharp-style: C# house style.');
    expect(result).toContain('- commits: Commits.');
    expect(result).toContain(`"${LOAD_SKILL}"`);
  });
});
