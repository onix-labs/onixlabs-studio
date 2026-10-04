import { describe, expect, it, vi } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import {
  AGENT_TEAM_VIEW,
  AgentTeamView,
  TeamWorkerView,
} from '@shared/angular/services/agent-team/agent-team-view';
import { AgentTeamStrip } from './agent-team-strip';

/**
 * The lead the strip is mounted over.
 */
const LEAD: Agent = {} as Agent;

/**
 * Builds a worker view with sensible defaults.
 * @param id The worker's id.
 * @param overrides The fields to override.
 * @returns Returns the view.
 */
function worker(id: string, overrides: Partial<TeamWorkerView> = {}): TeamWorkerView {
  return {
    id,
    title: `Task ${id}`,
    branch: `agent/${id}`,
    state: 'working',
    summary: null,
    pullRequest: null,
    agent: { respondPermission: vi.fn() } as unknown as Agent,
    pending: null,
    ...overrides,
  };
}

/**
 * The mounted strip and what a test needs to drive it.
 */
interface Harness {
  readonly fixture: ComponentFixture<AgentTeamStrip>;
  readonly host: HTMLElement;
  readonly workers: WritableSignal<readonly TeamWorkerView[]>;
  readonly opened: string[];
  readonly stopped: string[];
}

/**
 * Mounts the strip, with or without a team.
 * @param initial The workers the lead leads, or null for a host with no team.
 * @returns Returns the harness.
 */
function mount(initial: readonly TeamWorkerView[] | null): Harness {
  const workers: WritableSignal<readonly TeamWorkerView[]> = signal<readonly TeamWorkerView[]>(
    initial ?? [],
  );
  const opened: string[] = [];
  const stopped: string[] = [];
  const team: AgentTeamView = {
    workersLedBy: (lead: Agent): readonly TeamWorkerView[] => (lead === LEAD ? workers() : []),
    open: (id: string): void => void opened.push(id),
    stop: (id: string): void => void stopped.push(id),
  };
  TestBed.configureTestingModule({
    imports: [AgentTeamStrip],
    providers: [
      { provide: Agent, useValue: LEAD },
      ...(initial === null ? [] : [{ provide: AGENT_TEAM_VIEW, useValue: team }]),
    ],
  });
  const fixture: ComponentFixture<AgentTeamStrip> = TestBed.createComponent(AgentTeamStrip);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement, workers, opened, stopped };
}

/**
 * Finds a button by its accessible name.
 * @param host The rendered strip.
 * @param name The button's accessible name.
 * @returns Returns the button, or null.
 */
function button(host: HTMLElement, name: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

describe('AgentTeamStrip', () => {
  it('rendersNothing_inAHostWithNoTeam', () => {
    expect(mount(null).host.querySelector('.team')).toBeNull();
  });

  it('rendersNothing_whileTheAgentLeadsNoWorkers', () => {
    expect(mount([]).host.querySelector('.team')).toBeNull();
  });

  it('rendersARowPerWorker_withItsStateAndBranch', () => {
    const harness: Harness = mount([
      worker('w1'),
      worker('w2', { state: 'completed', summary: 'Added it.' }),
    ]);

    const rows: NodeListOf<HTMLElement> = harness.host.querySelectorAll('.team__row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Task w1');
    expect(rows[0].textContent).toContain('Working · agent/w1');
    expect(rows[1].textContent).toContain('Done');
    expect(rows[1].textContent).toContain('Added it.');
    // A finished worker cannot be stopped.
    expect(button(harness.host, 'Stop Task w2')).toBeNull();
    expect(button(harness.host, 'Stop Task w1')).not.toBeNull();
  });

  it('aPendingPermission_isAnsweredInPlace_onTheWorkersOwnItem', () => {
    const item: AgentItem = {
      id: 'p1',
      kind: 'permission',
      text: '',
      permissionName: 'Bash',
      permissionState: 'pending',
    };
    const respondPermission: ReturnType<typeof vi.fn> = vi.fn();
    const pending: TeamWorkerView = worker('w1', {
      state: 'input_required',
      pending: item,
      agent: { respondPermission } as unknown as Agent,
    });
    const harness: Harness = mount([pending]);

    expect(harness.host.querySelector('.team__waiting')?.textContent).toContain('1 needs you');
    expect(harness.host.textContent).toContain('Waiting on you for permission to use Bash');
    button(harness.host, 'Allow Task w1')?.click();

    expect(respondPermission).toHaveBeenCalledWith(item, true);
  });

  it('aPendingQuestion_isNotAnsweredInPlace_butOpensTheWorker', () => {
    const item: AgentItem = {
      id: 'q1',
      kind: 'input-request',
      text: '',
      inputQuestion: 'Which base?',
      inputState: 'pending',
    };
    const harness: Harness = mount([worker('w1', { state: 'input_required', pending: item })]);

    expect(button(harness.host, 'Allow Task w1')).toBeNull();
    button(harness.host, 'Open Task w1')?.click();

    expect(harness.opened).toEqual(['w1']);
  });

  it('stop_stopsTheWorker', () => {
    const harness: Harness = mount([worker('w1')]);

    button(harness.host, 'Stop Task w1')?.click();

    expect(harness.stopped).toEqual(['w1']);
  });

  it('followsTheTeamAsItChanges', () => {
    const harness: Harness = mount([worker('w1')]);

    harness.workers.set([worker('w1', { state: 'failed', summary: 'No base.' })]);
    harness.fixture.detectChanges();

    expect(harness.host.textContent).toContain('Failed');
    expect(harness.host.textContent).toContain('No base.');
  });
});
