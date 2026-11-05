import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorktreeChannel } from '@shared/api/worktree-channels';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the IPC handlers registered.
 */
const handlers: Map<string, Handler> = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => void handlers.set(channel, handler),
  },
  shell: { trashItem: (): Promise<void> => Promise.resolve() },
}));

const { WorktreeManager } = await import('./worktree-manager');
const { WorkspaceContext } = await import('../workspace-context');
const { TrustedPaths } = await import('../trusted-paths');

describe('WorktreeManager', () => {
  let sandbox: string;
  let root: string;

  /**
   * Invokes a captured IPC handler.
   * @param channel The channel.
   * @param args The renderer-supplied arguments.
   * @returns Returns what it answered.
   */
  async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler: Handler | undefined = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return await handler({}, ...args);
  }

  beforeEach(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-manager-')));
    root = path.join(sandbox, 'ws');
    fs.mkdirSync(root);
    handlers.clear();
    const workspace: InstanceType<typeof WorkspaceContext> = new WorkspaceContext();
    workspace.addRoot(root);
    const trusted: InstanceType<typeof TrustedPaths> = new TrustedPaths(
      path.join(sandbox, 'trusted.json'),
    );
    new WorktreeManager(workspace, trusted, {} as never).register();
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it.each([[undefined], [7], ['/not/open']])(
    'everyQuery_refusesARootThatIsNotOpen %#',
    async (candidate: unknown) => {
      expect(await invoke(WorktreeChannel.Resolve, candidate)).toBeNull();
      expect(await invoke(WorktreeChannel.Describe, candidate)).toBeNull();
      expect(await invoke(WorktreeChannel.Status, candidate)).toBeNull();
      expect(await invoke(WorktreeChannel.Branches, candidate)).toBeNull();
    },
  );

  it.each([
    [WorktreeChannel.Promote, []],
    [WorktreeChannel.AddCheckout, [{}]],
    [WorktreeChannel.RemoveCheckout, ['c1']],
    [WorktreeChannel.RenameCheckout, ['c1', 'alias']],
    [WorktreeChannel.OpenCheckout, ['c1']],
    [WorktreeChannel.DeleteBranch, ['c1', 'main', true]],
    [WorktreeChannel.CreateBranch, ['c1', 'new', true]],
  ])('%s_refusesARootThatIsNotOpen', async (channel: string, args: readonly unknown[]) => {
    expect(await invoke(channel, '/not/open', ...args)).toMatchObject({ ok: false });

    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('mutation_onAPlainWorkspace_saysItIsNotAContainer_withoutTouchingDisk', async () => {
    expect(await invoke(WorktreeChannel.RemoveCheckout, root, 'c1')).toEqual({
      ok: false,
      error: 'The workspace is not a worktree container.',
    });

    expect(fs.readdirSync(root)).toEqual([]);
  });
});
