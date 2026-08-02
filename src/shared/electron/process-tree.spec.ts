import { killProcessTree, signalProcessTree } from './process-tree';

/**
 * Records the (pid, signal) pairs delivered to the injected kill primitive, optionally throwing on
 * negated (group) pids to simulate a missing process group.
 */
class KillRecorder {
  public readonly delivered: [number, string][] = [];
  public failGroups: boolean = false;
  public readonly kill: (pid: number, signal: NodeJS.Signals) => void = (
    pid: number,
    signal: NodeJS.Signals,
  ): void => {
    if (this.failGroups && pid < 0) {
      throw new Error('ESRCH');
    }
    this.delivered.push([pid, signal]);
  };
}

describe('signalProcessTree', () => {
  it('signalsTheProcessGroupFirst', () => {
    const recorder: KillRecorder = new KillRecorder();
    signalProcessTree(100, 'SIGTERM', recorder.kill);
    expect(recorder.delivered).toEqual([[-100, 'SIGTERM']]);
  });

  it('fallsBackToTheSingleProcess_whenTheGroupSignalFails', () => {
    const recorder: KillRecorder = new KillRecorder();
    recorder.failGroups = true;
    signalProcessTree(100, 'SIGKILL', recorder.kill);
    expect(recorder.delivered).toEqual([[100, 'SIGKILL']]);
  });
});

describe('killProcessTree', () => {
  it('deliversSIGTERMImmediately_thenEscalatesToSIGKILLAfterTheGrace', async () => {
    const recorder: KillRecorder = new KillRecorder();
    killProcessTree(200, 10, recorder.kill);
    expect(recorder.delivered).toEqual([[-200, 'SIGTERM']]);

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 30);
    });
    expect(recorder.delivered).toEqual([
      [-200, 'SIGTERM'],
      [-200, 'SIGKILL'],
    ]);
  });
});
