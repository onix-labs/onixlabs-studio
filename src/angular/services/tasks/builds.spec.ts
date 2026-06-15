import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Builds, BuildHandler, BuildTask } from './builds';

/**
 * A controllable fake build handler.
 */
class FakeHandler implements BuildHandler {
  public readonly tasksSignal: WritableSignal<readonly BuildTask[]> = signal<readonly BuildTask[]>(
    [],
  );
  public readonly runningSignal: WritableSignal<boolean> = signal<boolean>(false);
  public readonly runCalls: string[] = [];
  public cancelCalls: number = 0;

  public get tasks(): WritableSignal<readonly BuildTask[]> {
    return this.tasksSignal;
  }

  public get running(): WritableSignal<boolean> {
    return this.runningSignal;
  }

  public run(taskId: string): void {
    this.runCalls.push(taskId);
  }

  public cancel(): void {
    this.cancelCalls += 1;
  }
}

/**
 * Builds a task for testing.
 * @param overrides The fields to override.
 * @returns Returns the task.
 */
function task(overrides: Partial<BuildTask>): BuildTask {
  return { id: 'id', label: 'l', group: 'build', command: 'c', cwd: '/w', ...overrides };
}

describe('Builds', () => {
  it('withNoHandler_exposesEmptyDefaults', () => {
    const builds: Builds = TestBed.inject(Builds);

    expect(builds.tasks()).toEqual([]);
    expect(builds.running()).toBe(false);
    expect(builds.canBuild()).toBe(false);
  });

  it('build_runsTheFirstBuildGroupTaskOfTheActiveHandler', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    handler.tasksSignal.set([
      task({ id: 'run', group: 'run' }),
      task({ id: 'build', group: 'build' }),
    ]);
    builds.register(handler);

    expect(builds.canBuild()).toBe(true);
    builds.build();

    expect(handler.runCalls).toEqual(['build']);
  });

  it('start_runsTheFirstRunGroupTask', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    handler.tasksSignal.set([task({ id: 'serve', group: 'run' })]);
    builds.register(handler);
    builds.start();

    expect(handler.runCalls).toEqual(['serve']);
  });

  it('unregister_clearsTheHandlerWhenItIsCurrent', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    handler.tasksSignal.set([task({ group: 'build' })]);
    builds.register(handler);
    builds.unregister(handler);

    expect(builds.canBuild()).toBe(false);
  });

  it('cancel_forwardsToTheActiveHandler', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    builds.register(handler);
    builds.cancel();

    expect(handler.cancelCalls).toBe(1);
  });
});
