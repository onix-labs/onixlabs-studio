import { TestBed } from '@angular/core/testing';
import { CodeTerminals } from '../code-terminals/code-terminals';
import { Task, TaskProvider } from './task';
import { Tasks } from './tasks';

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
    target: 'terminal',
    terminalTabId: 'tab-1',
    resolve: (): Promise<string | null> => Promise.resolve('echo hi'),
    ...overrides,
  };
}

describe('Tasks', () => {
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
        terminalTabId: 'tab-9',
        resolve: (): Promise<string | null> => Promise.resolve('node main.js'),
      }),
    );

    expect(codeTerminals.pending('tab-9')).toBe('node main.js');
  });

  it('run_whenResolveReturnsNull_doesNothing', async () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    const codeTerminals: CodeTerminals = TestBed.inject(CodeTerminals);
    await tasks.run(
      makeTask({
        terminalTabId: 'tab-9',
        resolve: (): Promise<string | null> => Promise.resolve(null),
      }),
    );

    expect(codeTerminals.pending('tab-9')).toBeNull();
  });

  it('run_outputTarget_isANoOp', async () => {
    const tasks: Tasks = TestBed.inject(Tasks);
    const codeTerminals: CodeTerminals = TestBed.inject(CodeTerminals);
    await tasks.run(makeTask({ target: 'output', terminalTabId: undefined }));

    expect(codeTerminals.pending('tab-1')).toBeNull();
  });
});
