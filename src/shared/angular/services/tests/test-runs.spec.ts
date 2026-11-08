import { describe, expect, it, vi } from 'vitest';
import { TestAtLocation, TestRunHandler, TestRuns } from './test-runs';

/**
 * Builds a handler for a folder that knows one test, on line 8 of `<root>/A.cs`.
 * @param root The folder.
 * @returns Returns the handler and its run spy.
 */
function handler(root: string): {
  readonly handler: TestRunHandler;
  readonly run: ReturnType<typeof vi.fn>;
} {
  const run: ReturnType<typeof vi.fn> = vi.fn((): Promise<boolean> => Promise.resolve(true));
  return {
    run,
    handler: {
      root: (): string => root,
      testAt: (path: string, line: number): TestAtLocation | null =>
        path === `${root}/A.cs` && line === 8
          ? { pluginId: 'p', id: `${root}:t`, label: 't', kind: 'test', debuggable: false }
          : null,
      run: run as unknown as TestRunHandler['run'],
    },
  };
}

describe('TestRuns (#1352)', () => {
  it('runAt_goesToTheWorkspaceHoldingTheFile', async () => {
    const runs: TestRuns = new TestRuns();
    const outer: ReturnType<typeof handler> = handler('/repo');
    const inner: ReturnType<typeof handler> = handler('/repo/nested');
    runs.register(outer.handler);
    runs.register(inner.handler);

    expect(await runs.runAt('/repo/nested/A.cs', 8, 'run')).toBe(true);

    expect(inner.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: '/repo/nested:t' }),
      'run',
    );
    expect(outer.run).not.toHaveBeenCalled();
  });

  it('runAt_aLineThatDeclaresNoTest_startsNothing', async () => {
    const runs: TestRuns = new TestRuns();
    const only: ReturnType<typeof handler> = handler('/repo');
    runs.register(only.handler);

    expect(await runs.runAt('/repo/A.cs', 9, 'debug')).toBe(false);
    expect(await runs.runAt('/elsewhere/A.cs', 8, 'run')).toBe(false);
    expect(only.run).not.toHaveBeenCalled();
  });

  it('register_returnsWhatUnregisters', () => {
    const runs: TestRuns = new TestRuns();
    const unregister: () => void = runs.register(handler('/repo').handler);

    unregister();

    expect(runs.testAt('/repo/A.cs', 8)).toBeNull();
  });

  it('testAt_doesNotMistakeASiblingFolderForTheWorkspace', () => {
    const runs: TestRuns = new TestRuns();
    runs.register(handler('/repo').handler);

    expect(runs.testAt('/repository/A.cs', 8)).toBeNull();
  });
});
