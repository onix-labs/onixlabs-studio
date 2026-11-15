import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { NetworkExplorerView } from '../network-explorer-view/network-explorer-view';
import { NetworkProbe } from '../network-probe/network-probe';
import { FakeNetworkProbe } from '../network-probe/network-probe.fake';
import { NetworkToolsClient } from '../network-tools-client/network-tools-client';
import { FakeNetworkToolsClient } from '../network-tools-client/network-tools-client.fake';
import { NetworkRun, NetworkRuns, PING_COUNT, TRACE_MAX_HOPS } from './network-runs';

describe('NetworkRuns', () => {
  let fixture: ComponentFixture<NetworkExplorerView>;
  let client: FakeNetworkToolsClient;
  let runs: NetworkRuns;

  beforeEach(async () => {
    client = new FakeNetworkToolsClient();
    TestBed.configureTestingModule({
      imports: [NetworkExplorerView],
      providers: [
        { provide: NetworkProbe, useValue: new FakeNetworkProbe() },
        { provide: NetworkToolsClient, useValue: client },
      ],
    });
    fixture = TestBed.createComponent(NetworkExplorerView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    await fixture.whenStable();
    runs = fixture.debugElement.injector.get(NetworkRuns);
  });

  /**
   * Gets the documents tabbed in the well.
   * @returns Returns their ids.
   */
  function wellDocuments(): readonly string[] {
    return (
      firstStackOfRole(fixture.debugElement.injector.get(DockState).layout(), 'document')?.panels ??
      []
    );
  }

  /**
   * Lets a resolved run's outcome land.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
  }

  it('ping_opensADocument_andRunsTheTool', () => {
    const id: string = runs.ping('1.1.1.1');

    expect(wellDocuments()).toEqual([id]);
    expect(fixture.debugElement.injector.get(DockPanelRegistry).get(id)?.title).toBe(
      'Ping 1.1.1.1',
    );
    expect(client.started[0].request).toEqual({ id, host: '1.1.1.1', count: PING_COUNT });
    expect(runs.run(id)?.status).toBe('running');
  });

  it('eachNewRun_comesToTheFrontOfTheWell', async () => {
    runs.ping('1.1.1.1');
    await settle();

    const trace: string = runs.trace('1.1.1.1');
    await settle();

    expect(
      firstStackOfRole(fixture.debugElement.injector.get(DockState).layout(), 'document')?.active,
    ).toBe(trace);
  });

  it('ping_gathersReplies_andRecordsTheOutcome', async () => {
    const id: string = runs.ping('1.1.1.1');

    client.started[0].reply({ sequence: 0, address: '1.1.1.1', ttl: 57, rttMs: 12 });
    client.started[0].reply({ sequence: 1 });
    client.started[0].end({ kind: 'completed', address: '1.1.1.1' });
    await settle();

    const run: NetworkRun | undefined = runs.run(id);
    expect(run?.kind === 'ping' ? run.replies.length : -1).toBe(2);
    expect(run?.status).toBe('completed');
    expect(run?.address).toBe('1.1.1.1');
  });

  it('ping_countsTheRequestsTheToolNeverReported_asTimedOut', async () => {
    const id: string = runs.ping('17.57.146.154');

    client.started[0].reply({ sequence: 0 });
    client.started[0].reply({ sequence: 1 });
    client.started[0].end({ kind: 'completed', transmitted: 3 });
    await settle();

    const run: NetworkRun | undefined = runs.run(id);
    expect(run?.kind === 'ping' ? run.replies : []).toEqual([
      { sequence: 0 },
      { sequence: 1 },
      { sequence: 2 },
    ]);
  });

  it('trace_keepsEachHopAsItLastStood_inOrder', async () => {
    const id: string = runs.trace('1.1.1.1');
    expect(client.started[0].request).toEqual({ id, host: '1.1.1.1', maxHops: TRACE_MAX_HOPS });

    client.started[0].hop({ index: 2, probes: [{}] });
    client.started[0].hop({ index: 1, probes: [{ address: '192.168.1.1', rttMs: 4 }] });
    client.started[0].hop({ index: 2, probes: [{}, { address: '10.0.0.1', rttMs: 9 }] });
    client.started[0].end({ kind: 'failed', message: 'traceroute: unknown host' });
    await settle();

    const run: NetworkRun | undefined = runs.run(id);
    expect(run?.kind === 'trace' ? run.hops.map((hop) => hop.probes.length) : []).toEqual([1, 2]);
    expect(run?.message).toBe('traceroute: unknown host');
  });

  it('runningTheSameToolAgainstTheSameHost_reusesItsDocument_onceItHasEnded', async () => {
    const first: string = runs.ping('1.1.1.1');
    client.started[0].end({ kind: 'completed' });
    await settle();

    const second: string = runs.ping('1.1.1.1');

    expect(second).toBe(first);
    expect(wellDocuments()).toEqual([first]);
    expect(client.started).toHaveLength(2);
  });

  it('aRunStillGoing_isNotReused', () => {
    const first: string = runs.ping('1.1.1.1');

    expect(runs.ping('1.1.1.1')).not.toBe(first);
  });

  it('stop_cancelsTheRun', async () => {
    const id: string = runs.trace('1.1.1.1');

    runs.stop(id);
    await settle();

    expect(client.cancelled).toEqual([id]);
    expect(runs.run(id)?.status).toBe('cancelled');
  });

  it('rerun_startsAnEndedRunAgain_fromNothing', async () => {
    const id: string = runs.ping('1.1.1.1');
    client.started[0].reply({ sequence: 0 });
    client.started[0].end({ kind: 'completed' });
    await settle();

    runs.rerun(id);

    const run: NetworkRun | undefined = runs.run(id);
    expect(run?.status).toBe('running');
    expect(run?.kind === 'ping' ? run.replies : undefined).toEqual([]);
  });

  it('closingTheTab_stopsEveryRunStillGoing', () => {
    const ping: string = runs.ping('1.1.1.1');
    const trace: string = runs.trace('8.8.8.8');

    fixture.destroy();

    expect(client.cancelled).toEqual([ping, trace]);
  });
});
