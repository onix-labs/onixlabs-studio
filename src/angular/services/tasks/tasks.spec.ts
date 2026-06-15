import { TestBed } from '@angular/core/testing';
import { TaskApi, TaskOutputStream, TaskRunRequest, TaskRunResult } from '../../../shared/task-types';
import { CodeTerminals } from '../code-terminals/code-terminals';
import { Output } from '../output/output';
import { Task, TaskProvider } from './task';
import { Tasks } from './tasks';

/**
 * A controllable fake of the task-runner bridge.
 */
class FakeTaskApi implements TaskApi {
  public readonly runCalls: TaskRunRequest[] = [];
  public readonly cancelCalls: string[] = [];
  private outputListener: ((runId: string, chunk: string, stream: TaskOutputStream) => void) | null =
    null;
  private exitListener: ((runId: string, code: number | null, signal: string | null) => void) | null =
    null;
  public nextResult: TaskRunResult = { success: true, pid: 1 };

  public run(request: TaskRunRequest): Promise<TaskRunResult> {
    this.runCalls.push(request);
    return Promise.resolve(this.nextResult);
  }

  public cancel(runId: string): Promise<boolean> {
    this.cancelCalls.push(runId);
    return Promise.resolve(true);
  }

  public onOutput(
    listener: (runId: string, chunk: string, stream: TaskOutputStream) => void,
  ): () => void {
    this.outputListener = listener;
    return (): void => {
      this.outputListener = null;
    };
  }

  public onExit(
    listener: (runId: string, code: number | null, signal: string | null) => void,
  ): () => void {
    this.exitListener = listener;
    return (): void => {
      this.exitListener = null;
    };
  }

  public emitOutput(runId: string, chunk: string): void {
    this.outputListener?.(runId, chunk, 'stdout');
  }

  public emitExit(runId: string, code: number | null): void {
    this.exitListener?.(runId, code, null);
  }
}

/**
 * Builds a task with sensible defaults for testing.
 * @param overrides The fields to override.
 * @returns Returns the task.
 */
function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'task',
    label: 'Task',
    source: 'test',
    target: 'output',
    resolve: (): Promise<string | null> => Promise.resolve('echo hi'),
    ...overrides,
  };
}

describe('Tasks', () => {
  let api: FakeTaskApi;

  beforeEach(() => {
    api = new FakeTaskApi();
    (window as unknown as { studio: { tasks: TaskApi } }).studio = { tasks: api };
  });

  afterEach(() => {
    delete (window as unknown as { studio?: unknown }).studio;
  });

  it('getTasks_aggregatesRegisteredProviders', async () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    const taskA: Task = makeTask({ id: 'a' });
    const provider: TaskProvider = {
      id: 'p',
      provideTasks: (): Task[] => [taskA],
    };
    tasks.register(provider);

    expect(await tasks.getTasks({})).toEqual([taskA]);
  });

  it('run_terminalTarget_queuesTheResolvedCommand', async () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    const codeTerminals: CodeTerminals = TestBed.inject(CodeTerminals);
    await tasks.run(
      makeTask({
        target: 'terminal',
        terminalTabId: 'tab-9',
        resolve: (): Promise<string | null> => Promise.resolve('node main.js'),
      }),
    );

    expect(codeTerminals.pending('tab-9')).toBe('node main.js');
    expect(api.runCalls).toHaveLength(0);
  });

  it('run_whenResolveReturnsNull_doesNothing', async () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    await tasks.run(makeTask({ resolve: (): Promise<string | null> => Promise.resolve(null) }));

    expect(api.runCalls).toHaveLength(0);
  });

  it('run_outputTarget_streamsOutputAndExitIntoTheOutputChannel', async () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    const output: Output = TestBed.inject(Output);
    await tasks.run(makeTask({ label: 'Build', target: 'output' }));

    expect(api.runCalls).toHaveLength(1);
    expect(api.runCalls[0].command).toBe('echo hi');
    const runId: string = api.runCalls[0].runId;

    api.emitOutput(runId, 'compiling...');
    api.emitExit(runId, 0);

    const snapshot: string = output.snapshot();
    expect(snapshot).toContain('> Build');
    expect(snapshot).toContain('compiling...');
    expect(snapshot).toContain('exited with code 0');
  });

  it('run_outputTarget_whenStartFails_reportsTheError', async () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    const output: Output = TestBed.inject(Output);
    api.nextResult = { success: false, error: 'boom' };
    await tasks.run(makeTask({ target: 'output' }));

    expect(output.snapshot()).toContain('boom');
  });

  it('cancel_forwardsToTheBridge', () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    tasks.cancel('run-1');

    expect(api.cancelCalls).toEqual(['run-1']);
  });
});
