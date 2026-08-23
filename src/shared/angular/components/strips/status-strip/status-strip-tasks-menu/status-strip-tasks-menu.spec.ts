import { describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AgentTask } from '@shared/angular/services/agent/agent';
import { AgentTaskOwner, AgentTasks } from '@shared/angular/services/agent-tasks/agent-tasks';
import { StatusStripTasksMenu } from './status-strip-tasks-menu';

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
 * The mounted component together with what a test needs to drive it.
 */
interface Harness {
  readonly fixture: ComponentFixture<StatusStripTasksMenu>;
  readonly host: HTMLElement;
  readonly tasks: WritableSignal<readonly AgentTask[]>;
  readonly stopped: string[];
}

/**
 * Mounts the menu over a registry holding one conversation's tasks.
 * @param initial The conversation's initial tasks.
 * @returns Returns the harness.
 */
function mount(initial: readonly AgentTask[]): Harness {
  const tasks: WritableSignal<readonly AgentTask[]> = signal<readonly AgentTask[]>(initial);
  const stopped: string[] = [];
  TestBed.configureTestingModule({ imports: [StatusStripTasksMenu], providers: [AgentTasks] });
  const registry: AgentTasks = TestBed.inject(AgentTasks);
  const owner: AgentTaskOwner = {
    tasks,
    title: (): string => 'Refactor',
    tabId: (): string | undefined => 'tab-1',
    reveal: (): void => undefined,
    stop: (taskId: string): void => void stopped.push(taskId),
  };
  registry.register('conv-a', owner);
  const fixture: ComponentFixture<StatusStripTasksMenu> =
    TestBed.createComponent(StatusStripTasksMenu);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement, tasks, stopped };
}

describe('StatusStripTasksMenu', () => {
  it('render_withNoTasks_showsNoTrigger_soTheStripStaysQuiet', () => {
    const harness: Harness = mount([]);

    expect(harness.host.querySelectorAll('.tasks-menu__trigger').length).toBe(0);
  });

  it('render_withLiveTasks_countsThem', () => {
    const harness: Harness = mount([task('t1'), task('t2')]);

    expect(harness.host.querySelectorAll('.tasks-menu__trigger').length).toBe(1);
    expect(harness.host.textContent).toContain('2');
  });

  it('render_whenTheLastTaskSettles_theTriggerDisappears', () => {
    const harness: Harness = mount([task('t1')]);
    expect(harness.host.querySelectorAll('.tasks-menu__trigger').length).toBe(1);

    harness.tasks.set([]);
    harness.fixture.detectChanges();

    expect(harness.host.querySelectorAll('.tasks-menu__trigger').length).toBe(0);
  });

  it('render_withOnlyAmbientTasks_showsNoTrigger', () => {
    // Ambient housekeeping is listed in the flyout, but never advertised on the strip.
    const harness: Harness = mount([task('t1', { skipTranscript: true })]);

    expect(harness.host.querySelectorAll('.tasks-menu__trigger').length).toBe(0);
  });

  it('triggerTitle_namesTheCount_andPluralisesCorrectly', () => {
    const harness: Harness = mount([task('t1')]);
    const trigger: HTMLElement | null = harness.host.querySelector('.tasks-menu__trigger');
    expect(trigger?.getAttribute('aria-label')).toBe('1 agent task running');

    harness.tasks.set([task('t1'), task('t2')]);
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('.tasks-menu__trigger')?.getAttribute('aria-label')).toBe(
      '2 agent tasks running',
    );
  });
});
