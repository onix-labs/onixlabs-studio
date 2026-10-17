import { describe, expect, it, vi } from 'vitest';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { downloadModel, listSkills, readMachineFacts, savePromptProfile, saveSkill } =
  await import('./ai-manager-tools');

/**
 * Builds a run context whose bridge answers with the given value.
 * @param answer What the renderer answers.
 * @returns Returns the context.
 */
function contextAnswering(answer: unknown): AgentRunContext {
  return {
    bridge: { request: (): Promise<unknown> => Promise.resolve(answer) },
  } as unknown as AgentRunContext;
}

describe('AI Manager tools', () => {
  it('readMachineFacts_reportsMemoryAndTheProcessor', () => {
    const facts: Record<string, unknown> = JSON.parse(readMachineFacts()) as Record<
      string,
      unknown
    >;

    expect(facts['platform']).toBe(process.platform);
    expect(facts['architecture']).toBe(process.arch);
    expect(typeof facts['memoryGiB']).toBe('number');
    expect(typeof facts['cores']).toBe('number');
  });

  it('saysWhenTheAiManagerIsNotOpen_orWhyItRefused', async () => {
    expect(await listSkills(contextAnswering({ available: false }))).toContain('not open');
    expect(await saveSkill(contextAnswering({ available: true, error: 'Bad tag.' }), {})).toBe(
      'Bad tag.',
    );
  });

  it('rendersListsAsJson_andWritesAsASentence', async () => {
    expect(
      JSON.parse(await listSkills(contextAnswering({ available: true, result: [{ name: 'a' }] }))),
    ).toEqual([{ name: 'a' }]);
    expect(
      await savePromptProfile(
        contextAnswering({ available: true, created: true, id: 'p1', name: 'Terse' }),
        {},
      ),
    ).toBe('Created the profile "Terse" (id p1).');
    expect(await downloadModel(contextAnswering({ available: true }), 'qwen3:8b')).toContain(
      'Started downloading qwen3:8b',
    );
  });
});
