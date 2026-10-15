import { describe, expect, it, vi } from 'vitest';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { installPlugin, listPlugins } = await import('./plugin-manager-tools');

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

describe('Plugin Manager tools', () => {
  it('installPlugin_saysWhetherItWasInstalled_declined_orFailed', async () => {
    expect(
      await installPlugin(
        contextAnswering({ available: true, outcome: 'installed', version: '1.2.0' }),
        'rust-analyzer',
      ),
    ).toBe('Installed rust-analyzer 1.2.0.');
    expect(
      await installPlugin(contextAnswering({ available: true, outcome: 'declined' }), 'x'),
    ).toBe("The user did not accept x's terms, so nothing was installed.");
    expect(
      await installPlugin(
        contextAnswering({ available: true, outcome: 'failed', reason: 'offline' }),
        'x',
      ),
    ).toBe('x could not be installed: offline');
  });

  it('saysWhenThePluginManagerIsNotOpen', async () => {
    expect(await listPlugins(contextAnswering({ available: false }), undefined)).toContain(
      'not open',
    );
  });
});
