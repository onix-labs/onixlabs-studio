import { describe, expect, it, vi } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent, AgentTask } from '@shared/angular/services/agent/agent';
import { AgentTasksMenu } from './agent-tasks-menu';

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
  readonly fixture: ComponentFixture<AgentTasksMenu>;
  readonly host: HTMLElement;
  readonly tasks: WritableSignal<readonly AgentTask[]>;
  readonly stopped: string[];
}

/**
 * Mounts the menu over a stub conversation reporting the given tasks.
 * @param initial The conversation's initial tasks.
 * @returns Returns the harness.
 */
function mount(initial: readonly AgentTask[]): Harness {
  const tasks: WritableSignal<readonly AgentTask[]> = signal<readonly AgentTask[]>(initial);
  const stopped: string[] = [];
  const agentStub: Pick<Agent, 'tasks' | 'stopTask'> = {
    tasks: tasks.asReadonly(),
    stopTask: (taskId: string): void => void stopped.push(taskId),
  };
  TestBed.configureTestingModule({
    imports: [AgentTasksMenu],
    providers: [{ provide: Agent, useValue: agentStub }],
  });
  const fixture: ComponentFixture<AgentTasksMenu> = TestBed.createComponent(AgentTasksMenu);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement, tasks, stopped };
}

describe('AgentTasksMenu', () => {
  it('open_showsWhenEachTaskStarted_andHowLongItHasRun', () => {
    // #1419: timed from when Studio saw the task start, not the provider's report. The ticking itself
    // is MenuClock's, tested there: the CDK closes an open menu as soon as fake timers run.
    vi.useFakeTimers();
    try {
      const started: number = new Date(2026, 10, 10, 14, 32, 0).getTime();
      vi.setSystemTime(started + 192_000);
      const harness: Harness = mount([task('t1', { startedAt: started, lastToolName: 'Bash' })]);
      harness.host.querySelector('button')?.click();
      harness.fixture.detectChanges();

      expect(document.querySelector('.tasks-menu__item-detail')?.textContent?.trim()).toBe(
        'Bash · Started 14:32 · 3m 12s',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('render_withNoTasks_showsNoTrigger_soTheComposerStaysQuiet', () => {
    const harness: Harness = mount([]);

    expect(harness.host.querySelectorAll('button').length).toBe(0);
  });

  it('render_withLiveTasks_showsTheSpinnerTrigger_withTheCountInItsLabelOnly', () => {
    const harness: Harness = mount([task('t1'), task('t2')]);

    expect(harness.host.querySelectorAll('button').length).toBe(1);
    // The spinner is the whole visual: the count lives in the accessible label, not the button face.
    expect(harness.host.querySelector('button')?.textContent?.trim()).toBe('');
  });

  it('render_whenTheLastTaskSettles_theTriggerDisappears', () => {
    const harness: Harness = mount([task('t1')]);
    expect(harness.host.querySelectorAll('button').length).toBe(1);

    harness.tasks.set([]);
    harness.fixture.detectChanges();

    expect(harness.host.querySelectorAll('button').length).toBe(0);
  });

  it('render_withOnlyAmbientTasks_showsNoTrigger', () => {
    // Ambient housekeeping is listed in the drop-up, but never advertised on the composer.
    const harness: Harness = mount([task('t1', { skipTranscript: true })]);

    expect(harness.host.querySelectorAll('button').length).toBe(0);
  });

  it('triggerTitle_namesTheCount_andPluralisesCorrectly', () => {
    const harness: Harness = mount([task('t1')]);
    const trigger: HTMLElement | null = harness.host.querySelector('button');
    expect(trigger?.getAttribute('aria-label')).toBe('1 background task running');

    harness.tasks.set([task('t1'), task('t2')]);
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('button')?.getAttribute('aria-label')).toBe(
      '2 background tasks running',
    );
  });
});
