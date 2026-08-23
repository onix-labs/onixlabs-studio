import { describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AgentTask } from '@shared/angular/services/agent/agent';
import { AgentTaskOwner, AgentTasks, LiveAgentTask } from './agent-tasks';

/**
 * Builds a live task with sensible defaults.
 * @param taskId The task's identifier.
 * @param overrides The fields to override.
 * @returns Returns the task.
 */
function task(taskId: string, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId,
    description: `doing ${taskId}`,
    tokens: 0,
    toolUses: 0,
    durationMs: 0,
    status: 'running',
    backgrounded: false,
    skipTranscript: false,
    ...overrides,
  };
}

/**
 * A registered owner together with the handles a test needs to drive and assert on it.
 */
interface OwnerFixture {
  readonly owner: AgentTaskOwner;
  readonly tasks: WritableSignal<readonly AgentTask[]>;
  readonly revealed: string[];
  readonly stopped: string[];
}

/**
 * Builds a registerable owner over a writable task list.
 * @param title The conversation's display name.
 * @param tasks The conversation's initial tasks.
 * @param tabId The owning tab, when it has one.
 * @returns Returns the owner, its task signal, and its recorded calls.
 */
function owner(
  title: string,
  tasks: readonly AgentTask[],
  tabId: string | undefined = 'tab-1',
): OwnerFixture {
  const taskSignal: WritableSignal<readonly AgentTask[]> = signal<readonly AgentTask[]>(tasks);
  const revealed: string[] = [];
  const stopped: string[] = [];
  return {
    owner: {
      tasks: taskSignal,
      title: (): string => title,
      tabId: (): string | undefined => tabId,
      reveal: (): void => void revealed.push(title),
      stop: (taskId: string): void => void stopped.push(taskId),
    },
    tasks: taskSignal,
    revealed,
    stopped,
  };
}

describe('AgentTasks', () => {
  /**
   * Builds the registry under test.
   * @returns Returns the registry.
   */
  function make(): AgentTasks {
    TestBed.configureTestingModule({ providers: [AgentTasks] });
    return TestBed.inject(AgentTasks);
  }

  it('tasks_areAggregatedAcrossConversations_andAttributedToTheirAgent', () => {
    const registry: AgentTasks = make();
    const a: OwnerFixture = owner('Refactor', [task('t1')], 'tab-1');
    const b: OwnerFixture = owner('Docs', [task('t2'), task('t3')], 'tab-2');
    registry.register('conv-a', a.owner);
    registry.register('conv-b', b.owner);

    // A task outlives the tab it was launched from, so the registry answers app-wide, not per tab.
    expect(registry.count()).toBe(3);
    const attributed: readonly LiveAgentTask[] = registry.tasks();
    expect(attributed.find((t: LiveAgentTask): boolean => t.taskId === 't1')?.ownerTitle).toBe(
      'Refactor',
    );
    expect(attributed.find((t: LiveAgentTask): boolean => t.taskId === 't2')?.ownerTabId).toBe(
      'tab-2',
    );
  });

  it('count_excludesAmbientTasks_whichAreStillListed', () => {
    const registry: AgentTasks = make();
    registry.register('conv-a', owner('Refactor', [task('t1', { skipTranscript: true })]).owner);

    // Ambient housekeeping belongs in the list — that is what it was kept in the registry for — but is
    // never advertised on the strip.
    expect(registry.count()).toBe(0);
    expect(registry.tasks().length).toBe(1);
  });

  it('unregister_dropsTheConversation_soAClosedTabCannotBeNamed', () => {
    const registry: AgentTasks = make();
    const a: OwnerFixture = owner('Refactor', [task('t1')]);
    const drop: () => void = registry.register('conv-a', a.owner);
    expect(registry.count()).toBe(1);

    drop();

    expect(registry.tasks()).toEqual([]);
  });

  it('unregister_afterTheIdWasReRegistered_leavesTheLiveConversationAlone', () => {
    const registry: AgentTasks = make();
    const first: OwnerFixture = owner('First', [task('t1')]);
    const second: OwnerFixture = owner('Second', [task('t2')]);
    const dropFirst: () => void = registry.register('conv-a', first.owner);
    // The same conversation id is registered again (a rebuilt view) before the old one tears down.
    registry.register('conv-a', second.owner);

    dropFirst();

    // The stale teardown must not strand the live conversation's tasks.
    expect(registry.count()).toBe(1);
    expect(registry.tasks()[0].ownerTitle).toBe('Second');
  });

  it('revealAndStop_areRoutedToTheOwningConversation', () => {
    const registry: AgentTasks = make();
    const a: OwnerFixture = owner('Refactor', [task('t1')]);
    const b: OwnerFixture = owner('Docs', [task('t2')]);
    registry.register('conv-a', a.owner);
    registry.register('conv-b', b.owner);

    const target: LiveAgentTask = registry
      .tasks()
      .find((t: LiveAgentTask): boolean => t.taskId === 't2')!;
    registry.reveal(target);
    registry.stop(target);

    expect(b.revealed).toEqual(['Docs']);
    expect(b.stopped).toEqual(['t2']);
    expect(a.revealed).toEqual([]);
    expect(a.stopped).toEqual([]);
  });

  it('tasks_trackTheOwnersLiveSignal_soASettleDisappearsImmediately', () => {
    const registry: AgentTasks = make();
    const a: OwnerFixture = owner('Refactor', [task('t1')]);
    registry.register('conv-a', a.owner);
    expect(registry.count()).toBe(1);

    a.tasks.set([]);

    expect(registry.count()).toBe(0);
  });

  it('stop_forAConversationThatHasGone_isANoOp', () => {
    const registry: AgentTasks = make();
    const a: OwnerFixture = owner('Refactor', [task('t1')]);
    registry.register('conv-a', a.owner);
    const target: LiveAgentTask = registry.tasks()[0];
    const drop: () => void = registry.register('conv-a', a.owner);
    drop();

    // The tab closed between the list rendering and the user pressing Stop.
    expect((): void => registry.stop(target)).not.toThrow();
    expect(a.stopped).toEqual([]);
  });
});
