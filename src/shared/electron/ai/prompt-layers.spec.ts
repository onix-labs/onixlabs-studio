import { describe, expect, it } from 'vitest';
import { LOAD_SKILL } from '@shared/api/ai-types';
import type { AgentRunContext, OfferedSkill } from './agent-provider';
import { skillsAppendix, withSystemPromptExtra } from './prompt-layers';

/**
 * Builds a run context carrying only the prompt layers.
 * @param overrides Fields to set.
 * @returns Returns the context.
 */
function contextFor(overrides: Partial<Record<string, unknown>> = {}): AgentRunContext {
  return {
    prompt: 'do the thing',
    systemPromptExtra: '',
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

  it('withSystemPromptExtra_saysTheInstructionsMayChange_soAnEditIsNotApologisedFor', () => {
    // #955: told nothing, a model handed edited instructions apologises for earlier replies.
    const result: string = withSystemPromptExtra('base', contextFor({ systemPromptExtra: 'x' }));

    expect(result).toContain('may change them during a conversation');
    expect(result).toContain('do not comment on whether earlier replies followed them');
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
