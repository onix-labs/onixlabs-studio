import { TestBed } from '@angular/core/testing';
import { NetworkNames } from '../network-names/network-names';
import { FakeNetworkNames } from '../network-names/network-names.fake';
import { NetworkProbe } from '../network-probe/network-probe';
import { FakeNetworkProbe } from '../network-probe/network-probe.fake';
import { ConnectionRow, InterfaceRow, NetworkActivity } from './network-activity';
import { activity, sampleConnections, sampleNetwork } from './network-samples.testing';

describe('NetworkActivity', () => {
  let probe: FakeNetworkProbe;
  let names: FakeNetworkNames;
  let activityStore: NetworkActivity;

  beforeEach(async () => {
    probe = new FakeNetworkProbe();
    probe.network = sampleNetwork;
    names = new FakeNetworkNames();
    TestBed.configureTestingModule({
      providers: [
        NetworkActivity,
        { provide: NetworkProbe, useValue: probe },
        { provide: NetworkNames, useValue: names },
      ],
    });
    activityStore = TestBed.inject(NetworkActivity);
    activityStore.open();
    await activityStore.refresh();
    probe.push({
      timestamp: '',
      interfaces: [activity('en0', 2048), activity('lo0', 10)],
      connections: sampleConnections,
    });
  });

  /**
   * Gets the processes of the listed connections.
   * @returns Returns them, in order.
   */
  function listedProcesses(): readonly (string | undefined)[] {
    return activityStore
      .connections()
      .map((row: ConnectionRow): string | undefined => row.connection.process);
  }

  it('open_startsSamplingOnce_andCloseStopsIt', () => {
    activityStore.open();
    expect(probe.consumers).toBe(1);
    expect(probe.subscribed).toBe(1);

    activityStore.close();

    expect(probe.consumers).toBe(0);
    expect(probe.subscribed).toBe(0);
  });

  it('interfaces_listThoseInUse_defaultFirst_withActivityAndConnectionCounts', () => {
    const rows: readonly InterfaceRow[] = activityStore.interfaces();

    expect(rows.map((row: InterfaceRow): string => row.info.id)).toEqual(['en0', 'lo0']);
    expect(rows[0].reading?.rxBytesPerSecond).toBe(2048);
    expect(rows.map((row: InterfaceRow): number => row.connections)).toEqual([1, 1]);
  });

  it('interfaces_includeIdleOnes_whenAsked', () => {
    activityStore.showIdleInterfaces.set(true);

    expect(activityStore.interfaces().map((row: InterfaceRow): string => row.info.id)).toContain(
      'awdl0',
    );
  });

  it('connections_leaveOutListeningSocketsAndLoopback_byDefault', () => {
    expect(listedProcesses()).toEqual(['Safari']);

    activityStore.showLoopback.set(true);

    expect(listedProcesses()).toEqual(['Safari', 'node']);
  });

  it('select_narrowsToTheInterface_andSelectingAgainWidens', () => {
    activityStore.select('lo0');
    expect(listedProcesses()).toEqual(['node']);
    expect(activityStore.selectedInterface()?.name).toBe('Loopback');

    activityStore.select('lo0');

    expect(activityStore.selectedInterfaceId()).toBeNull();
  });

  it('connectionQuery_filtersByProcessOrAddress', () => {
    activityStore.showLoopback.set(true);

    activityStore.connectionQuery.set('5432');
    expect(listedProcesses()).toEqual(['node']);

    activityStore.connectionQuery.set('safari');
    expect(listedProcesses()).toEqual(['Safari']);
  });

  it('asksForTheNamesOfRemoteHosts_butNotTheLoopback', () => {
    expect(names.asked).toEqual(['140.82.112.3']);
  });

  it('connections_carryTheRemoteHostsName_andTheFilterMatchesIt', () => {
    names.name('140.82.112.3', 'api.github.com');

    activityStore.connectionQuery.set('GITHUB');

    expect(activityStore.connections().map((row: ConnectionRow) => row.remoteName)).toEqual([
      'api.github.com',
    ]);
  });

  it('aReadingWithoutConnections_keepsTheLastList', () => {
    probe.push({ timestamp: '', interfaces: [activity('en0', 1)] });

    expect(listedProcesses()).toEqual(['Safari']);
    expect(activityStore.interfaces()[0].reading?.rxBytesPerSecond).toBe(1);
  });

  it('refresh_clearsASelectionWhoseInterfaceHasGone', async () => {
    activityStore.select('lo0');
    probe.network = { ...sampleNetwork, interfaces: sampleNetwork.interfaces.slice(1) };

    await activityStore.refresh();

    expect(activityStore.selectedInterfaceId()).toBeNull();
  });
});
