import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkRun, NetworkRuns } from '../../network-runs/network-runs';
import { RunPanel } from './run-panel';

/**
 * A stand-in for the tab's runs: it holds the runs the test gives it and records what it is asked.
 */
class FakeRuns {
  /**
   * Gets the runs, by id.
   */
  public readonly runs: WritableSignal<ReadonlyMap<string, NetworkRun>> = signal<
    ReadonlyMap<string, NetworkRun>
  >(new Map<string, NetworkRun>());

  /**
   * Gets what was asked, in order.
   */
  public readonly calls: string[] = [];

  /**
   * Records a stop.
   * @param id The run's id.
   */
  public stop(id: string): void {
    this.calls.push(`stop ${id}`);
  }

  /**
   * Records a rerun.
   * @param id The run's id.
   */
  public rerun(id: string): void {
    this.calls.push(`rerun ${id}`);
  }
}

describe('RunPanel', () => {
  let fixture: ComponentFixture<RunPanel>;
  let host: HTMLElement;
  let runs: FakeRuns;

  beforeEach(async () => {
    runs = new FakeRuns();
    await TestBed.configureTestingModule({
      imports: [RunPanel],
      providers: [{ provide: NetworkRuns, useValue: runs }],
    }).compileComponents();
    fixture = TestBed.createComponent(RunPanel);
    fixture.componentRef.setInput('panel', {
      id: 'run-1',
      title: 'Run',
      icon: Icon.NETWORK_PING,
      role: 'document',
      component: RunPanel,
    } satisfies DockPanel);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Shows a run.
   * @param run The run.
   */
  async function show(run: NetworkRun): Promise<void> {
    runs.runs.set(new Map<string, NetworkRun>([[run.id, run]]));
    await fixture.whenStable();
  }

  /**
   * Gets the text of a table's body rows.
   * @param testId The table's test id.
   * @returns Returns each row's text.
   */
  function rows(testId: string): readonly string[] {
    return Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"] tbody tr`)).map(
      (row: HTMLElement): string =>
        Array.from(row.querySelectorAll('td'))
          .map((cell: HTMLTableCellElement): string => cell.textContent.trim())
          .join(' ')
          .replace(/\s+/g, ' '),
    );
  }

  /**
   * Clicks the strip's button with a label.
   * @param label The label.
   */
  function click(label: string): void {
    Array.from(host.querySelectorAll<HTMLButtonElement>('app-panel-toolbar button'))
      .find((button: HTMLButtonElement): boolean => button.textContent.trim() === label)
      ?.click();
  }

  it('aPing_showsItsRepliesAndSummary', async () => {
    await show({
      kind: 'ping',
      id: 'run-1',
      host: 'one.one.one.one',
      address: '1.1.1.1',
      status: 'running',
      replies: [{ sequence: 0, address: '1.1.1.1', ttl: 57, rttMs: 12 }, { sequence: 1 }],
    });

    expect(host.querySelector('[data-testid="run-heading"]')?.textContent).toBe(
      'Ping one.one.one.one',
    );
    expect(host.textContent).toContain('1.1.1.1');
    expect(rows('ping-replies')).toEqual(['0 1.1.1.1 57 12.0 ms', '1 — — Timed out']);
    const summary: readonly string[] = Array.from(
      host.querySelectorAll('[data-testid="ping-summary"] div'),
    ).map((entry: Element): string =>
      Array.from(entry.children)
        .map((part: Element): string => part.textContent.trim())
        .join(': '),
    );
    expect(summary).toContain('Loss: 50%');
    expect(summary).toContain('Min / Avg / Max: 12.0 ms / 12.0 ms / 12.0 ms');
  });

  it('aRoute_showsEachHop_withLoadBalancedAddressesAndTimeouts', async () => {
    await show({
      kind: 'trace',
      id: 'run-1',
      host: '1.1.1.1',
      status: 'completed',
      hops: [
        {
          index: 1,
          probes: [
            { address: '141.101.71.174', rttMs: 15.6 },
            { address: '141.101.71.175', rttMs: 15.7 },
            {},
          ],
        },
        { index: 2, probes: [{}, {}, {}] },
      ],
    });

    expect(rows('route-hops')).toEqual([
      '1 141.101.71.174, 141.101.71.175 15.6 ms 15.7 ms *',
      '2 No answer * * *',
    ]);
    expect(host.querySelector('[data-testid="run-status"]')?.textContent?.trim()).toBe('Done');
  });

  it('aFailedRun_saysWhy', async () => {
    await show({
      kind: 'trace',
      id: 'run-1',
      host: 'nowhere.invalid',
      status: 'failed',
      message: 'traceroute: unknown host nowhere.invalid',
      hops: [],
    });

    expect(host.querySelector('[data-testid="run-message"]')?.textContent).toBe(
      'traceroute: unknown host nowhere.invalid',
    );
  });

  it('offersStopWhileRunning_andRunAgainAfter', async () => {
    await show({ kind: 'ping', id: 'run-1', host: '1.1.1.1', status: 'running', replies: [] });
    click('Stop');

    await show({ kind: 'ping', id: 'run-1', host: '1.1.1.1', status: 'cancelled', replies: [] });
    click('Run Again');

    expect(runs.calls).toEqual(['stop run-1', 'rerun run-1']);
  });
});
