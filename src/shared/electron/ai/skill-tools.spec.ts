import { describe, expect, it, vi } from 'vitest';
import { LOAD_SKILL } from '@shared/api/ai-types';
import type { AgentRunContext, OfferedSkill } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { createSkillTools } = await import('./skill-tools');

/**
 * The shape of a built tool this spec calls through.
 */
interface Callable {
  readonly execute: (args: { name: string }) => Promise<string>;
}

/**
 * Builds a run context offering the given skills.
 * @param skills The skills.
 * @returns Returns the context.
 */
function contextFor(skills: readonly OfferedSkill[]): AgentRunContext {
  return { skills } as unknown as AgentRunContext;
}

describe('createSkillTools', () => {
  it('createSkillTools_whenNoSkillInScope_offersNoTool', async () => {
    expect(Object.keys(await createSkillTools(contextFor([])))).toEqual([]);
  });

  it('createSkillTools_load_returnsTheBodyAndBundledFiles', async () => {
    const tools: Record<string, unknown> = await createSkillTools(
      contextFor([
        {
          name: 'csharp-style',
          description: 'C#.',
          load: (): Promise<{ body: string; files: readonly string[] }> =>
            Promise.resolve({ body: 'Explicit types.', files: ['/lib/csharp-style/ref.md'] }),
        },
      ]),
    );

    const result: string = await (tools[LOAD_SKILL] as Callable).execute({ name: 'CSharp-Style ' });

    expect(result).toContain('# Skill: csharp-style');
    expect(result).toContain('Explicit types.');
    expect(result).toContain('/lib/csharp-style/ref.md');
  });

  it('createSkillTools_load_whenUnknownName_namesWhatIsAvailable', async () => {
    const tools: Record<string, unknown> = await createSkillTools(
      contextFor([
        { name: 'a', description: 'A.', load: (): Promise<null> => Promise.resolve(null) },
      ]),
    );

    const result: string = await (tools[LOAD_SKILL] as Callable).execute({ name: 'zzz' });

    expect(result).toContain('no skill named "zzz"');
    expect(result).toContain('a');
  });

  it('createSkillTools_load_whenSkillVanished_saysSo', async () => {
    const tools: Record<string, unknown> = await createSkillTools(
      contextFor([
        { name: 'a', description: 'A.', load: (): Promise<null> => Promise.resolve(null) },
      ]),
    );

    expect(await (tools[LOAD_SKILL] as Callable).execute({ name: 'a' })).toContain('no longer');
  });
});
