import { describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent, AgentTask } from '@shared/angular/services/agent/agent';
import { AgentStatusStrip } from './agent-status-strip';

/**
 * Builds a live task with sensible defaults, overridden per test.
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
 * Mounts the strip over a stub agent exposing the given tasks.
 * @param tasks The conversation's live tasks.
 * @returns Returns the fixture and the writable task signal.
 */
function mount(tasks: readonly AgentTask[]): {
  fixture: ComponentFixture<AgentStatusStrip>;
  host: HTMLElement;
  tasksSignal: WritableSignal<readonly AgentTask[]>;
} {
  const tasksSignal: WritableSignal<readonly AgentTask[]> = signal<readonly AgentTask[]>(tasks);
  const agentStub: Pick<Agent, 'tasks'> = { tasks: tasksSignal };
  TestBed.configureTestingModule({
    imports: [AgentStatusStrip],
    providers: [{ provide: Agent, useValue: agentStub }],
  });
  const fixture: ComponentFixture<AgentStatusStrip> = TestBed.createComponent(AgentStatusStrip);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement, tasksSignal };
}

/**
 * Counts the rendered segments.
 * @param host The component's host element.
 * @returns Returns how many segments are on the strip.
 */
function segmentCount(host: HTMLElement): number {
  return host.querySelectorAll('app-status-strip-segment').length;
}

describe('AgentStatusStrip', () => {
  it('render_withNoTasks_showsNothing_soTheStripStaysQuiet', () => {
    const { host } = mount([]);

    expect(segmentCount(host)).toBe(0);
  });

  it('render_withLiveTasks_countsThem_andPluralisesCorrectly', () => {
    const { fixture, host, tasksSignal } = mount([task('a')]);

    expect(host.textContent).toContain('1 task');
    expect(host.textContent).not.toContain('1 tasks');

    tasksSignal.set([task('a'), task('b')]);
    fixture.detectChanges();
    expect(host.textContent).toContain('2 tasks');
  });

  it('render_ignoresAmbientTasks_whichTheTranscriptAlsoHides', () => {
    const { host } = mount([task('a', { skipTranscript: true })]);

    // Ambient housekeeping stays in the registry for a tasks surface, but is never advertised here.
    expect(segmentCount(host)).toBe(0);
  });

  it('render_whenTheLastTaskSettles_theSegmentDisappears', () => {
    const { fixture, host, tasksSignal } = mount([task('a')]);
    expect(host.textContent).toContain('1 task');

    tasksSignal.set([]);
    fixture.detectChanges();

    expect(segmentCount(host)).toBe(0);
  });
});
