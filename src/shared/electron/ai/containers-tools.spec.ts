import { describe, expect, it, vi } from 'vitest';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { listContainers, pullImage, readContainerLogs, refuseUnconfinedMounts } =
  await import('./containers-tools');

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

/**
 * Builds a run context with a write area.
 * @param workspaceRoot The workspace root, or null for none.
 * @param allowedWritePaths The user's allowed write paths.
 * @param deniedWritePaths The user's denied write paths.
 * @returns Returns the context.
 */
function confined(
  workspaceRoot: string | null,
  allowedWritePaths: readonly string[] = [],
  deniedWritePaths: readonly string[] = [],
): AgentRunContext {
  return { workspaceRoot, allowedWritePaths, deniedWritePaths } as unknown as AgentRunContext;
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

  describe('refuseUnconfinedMounts', () => {
    it('allowsFoldersInsideTheWriteArea_andNamedVolumesAnywhere', () => {
      const context: AgentRunContext = confined('/ws', ['/shared']);
      expect(
        refuseUnconfinedMounts(context, {
          image: 'postgres:16',
          volumes: [
            { source: '/ws/data', target: '/data' },
            { source: './cache', target: '/cache' },
            { source: '/shared/models', target: '/models', readOnly: true },
            { source: 'pgdata', target: '/var/lib/postgresql/data' },
          ],
        }),
      ).toBeNull();
      expect(refuseUnconfinedMounts(context, { image: 'nginx' })).toBeNull();
    });

    it('refusesAFolderOutsideTheArea_evenReadOnly_andNeverAsksFirst', () => {
      // Audit S3: `/:/host` or the engine's own socket used to reach the prompt, which showed nothing.
      const context: AgentRunContext = confined('/ws');
      for (const source of ['/', '/var/run/docker.sock', '/ws/../etc', '~/.ssh', '/Users/me']) {
        expect(
          refuseUnconfinedMounts(context, {
            image: 'alpine',
            volumes: [{ source, target: '/host', readOnly: true }],
          }),
        ).toContain('outside the agent');
      }
    });

    it('refusesADeniedPath_insideTheArea', () => {
      expect(
        refuseUnconfinedMounts(confined('/ws', [], ['.env']), {
          image: 'alpine',
          volumes: [{ source: '/ws/.env', target: '/env' }],
        }),
      ).toContain('outside the agent');
    });

    it('withNoWorkspace_refusesEveryFolder_butNotAVolume', () => {
      const context: AgentRunContext = confined(null);
      expect(
        refuseUnconfinedMounts(context, {
          image: 'alpine',
          volumes: [{ source: '/tmp/x', target: '/x' }],
        }),
      ).toContain('outside the agent');
      expect(
        refuseUnconfinedMounts(context, {
          image: 'alpine',
          volumes: [{ source: 'cache', target: '/x' }],
        }),
      ).toBeNull();
    });
  });
});
