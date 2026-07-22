import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProjectAction } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { ActiveRun, Builds, BuildHandler, BuildTask } from './builds';

/**
 * A controllable fake build handler.
 */
class FakeHandler implements BuildHandler {
  public readonly tasksSignal: WritableSignal<readonly BuildTask[]> = signal<readonly BuildTask[]>(
    [],
  );
  public readonly runsSignal: WritableSignal<readonly ActiveRun[]> = signal<readonly ActiveRun[]>(
    [],
  );
  public readonly runCalls: string[] = [];
  public readonly configurationCalls: RunConfiguration[] = [];
  public readonly actionCalls: ProjectAction[] = [];
  public readonly cancelledRunIds: string[] = [];
  public cancelAllCalls: number = 0;

  public get tasks(): WritableSignal<readonly BuildTask[]> {
    return this.tasksSignal;
  }

  public get activeRuns(): WritableSignal<readonly ActiveRun[]> {
    return this.runsSignal;
  }

  public run(taskId: string): void {
    this.runCalls.push(taskId);
  }

  public runConfiguration(configuration: RunConfiguration): void {
    this.configurationCalls.push(configuration);
  }

  public runAction(action: ProjectAction): void {
    this.actionCalls.push(action);
  }

  public cancel(runId: string): void {
    this.cancelledRunIds.push(runId);
  }

  public cancelAll(): void {
    this.cancelAllCalls += 1;
  }
}

/**
 * Builds an in-flight run for testing.
 * @param overrides The fields to override.
 * @returns Returns the run.
 */
function activeRun(overrides: Partial<ActiveRun>): ActiveRun {
  return { id: 'r1', label: 'l', taskId: 'id', startedAt: 0, ...overrides };
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
    expect(builds.activeRuns()).toEqual([]);
    expect(builds.running()).toBe(false);
    expect(builds.canBuild()).toBe(false);
  });

  it('running_followsWhetherTheActiveHandlerHasAnyRunInFlight', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    builds.register(handler);

    expect(builds.running()).toBe(false);

    // Several runs can be live at once; the ribbon reads them all, and `running` is simply "any".
    handler.runsSignal.set([activeRun({ id: 'r1' }), activeRun({ id: 'r2' })]);
    expect(builds.running()).toBe(true);
    expect(builds.activeRuns().map((run: ActiveRun): string => run.id)).toEqual(['r1', 'r2']);

    handler.runsSignal.set([]);
    expect(builds.running()).toBe(false);
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

  it('unregister_clearsTheHandlerWhenItIsCurrent', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    handler.tasksSignal.set([task({ group: 'build' })]);
    builds.register(handler);
    builds.unregister(handler);

    expect(builds.canBuild()).toBe(false);
  });

  it('cancel_forwardsOneRunIdToTheActiveHandler', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    builds.register(handler);
    builds.cancel('r2');

    expect(handler.cancelledRunIds).toEqual(['r2']);
    expect(handler.cancelAllCalls).toBe(0);
  });

  it('cancelAll_forwardsToTheActiveHandler', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    builds.register(handler);
    builds.cancelAll();

    expect(handler.cancelAllCalls).toBe(1);
    expect(handler.cancelledRunIds).toEqual([]);
  });

  it('runConfiguration_forwardsToTheActiveHandler', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    builds.register(handler);
    const configuration: RunConfiguration = {
      id: 'c',
      name: 'C',
      providerKind: 'dotnet',
      mode: 'run',
    };
    builds.runConfiguration(configuration);

    expect(handler.configurationCalls).toEqual([configuration]);
  });

  it('runAction_forwardsToTheActiveHandler', () => {
    const builds: Builds = TestBed.inject(Builds);
    const handler: FakeHandler = new FakeHandler();
    builds.register(handler);
    builds.runAction('clean');

    expect(handler.actionCalls).toEqual(['clean']);
  });
});
