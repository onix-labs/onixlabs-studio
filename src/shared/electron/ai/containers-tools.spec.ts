import { describe, expect, it, vi } from 'vitest';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { listContainers, pullImage, readContainerLogs } = await import('./containers-tools');

/**
 * Builds a run context whose bridge answers with the given value, recording what it was asked.
 * @param answer What the renderer answers.
 * @param asked Where to record each request's timeout.
 * @returns Returns the context.
 */
function contextAnswering(answer: unknown, asked: (number | undefined)[] = []): AgentRunContext {
  return {
    bridge: {
      request: (_name: string, _input: unknown, timeoutMs?: number): Promise<unknown> => {
        asked.push(timeoutMs);
        return Promise.resolve(answer);
      },
    },
  } as unknown as AgentRunContext;
}

describe('Containers tools', () => {
  it('readContainerLogs_givesTheLines_andSaysWhenOlderOnesWereLeftOut', async () => {
    expect(
      await readContainerLogs(
        contextAnswering({ available: true, lines: ['a', 'b'], truncated: true }),
        'api',
        undefined,
      ),
    ).toBe('(older lines left out)\na\nb');
    expect(
      await readContainerLogs(
        contextAnswering({ available: true, lines: [], truncated: false }),
        'api',
        10,
      ),
    ).toBe('api has written nothing to its log.');
  });

  it('pullImage_waitsLongEnoughForALargeImage', async () => {
    const asked: (number | undefined)[] = [];
    expect(await pullImage(contextAnswering({ available: true }, asked), 'postgres:16')).toBe(
      'Pulled postgres:16.',
    );
    expect(asked[0]).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('saysWhenTheContainersViewIsNotOpen', async () => {
    expect(await listContainers(contextAnswering({ available: false }), undefined)).toContain(
      'not open',
    );
  });
});
