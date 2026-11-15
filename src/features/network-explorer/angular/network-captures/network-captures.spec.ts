import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { CapturedPacketRow } from '@shared/api/network-capture-channels';
import { CaptureClient } from '../capture-client/capture-client';
import { FakeCaptureClient } from '../capture-client/capture-client.fake';
import { NetworkExplorerView } from '../network-explorer-view/network-explorer-view';
import { NetworkProbe } from '../network-probe/network-probe';
import { FakeNetworkProbe } from '../network-probe/network-probe.fake';
import { Capture, NetworkCaptures } from './network-captures';

/**
 * Builds a packet row.
 * @param number The packet's number.
 * @param length Its length on the wire.
 * @returns Returns the row.
 */
function row(number: number, length: number = 60): CapturedPacketRow {
  return {
    number,
    timestampMs: number * 1000,
    length,
    summary: { protocol: 'TCP', source: '10.0.0.1:1', destination: '10.0.0.2:2', info: '' },
  };
}

describe('NetworkCaptures', () => {
  let fixture: ComponentFixture<NetworkExplorerView>;
  let client: FakeCaptureClient;
  let captures: NetworkCaptures;

  beforeEach(async () => {
    client = new FakeCaptureClient();
    TestBed.configureTestingModule({
      imports: [NetworkExplorerView],
      providers: [
        { provide: NetworkProbe, useValue: new FakeNetworkProbe() },
        { provide: CaptureClient, useValue: client },
      ],
    });
    fixture = TestBed.createComponent(NetworkExplorerView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    await fixture.whenStable();
    captures = fixture.debugElement.injector.get(NetworkCaptures);
  });

  /**
   * Gets a capture.
   * @param id The capture's id.
   * @returns Returns it.
   */
  function capture(id: string): Capture | undefined {
    return captures.captures().get(id);
  }

  it('watchInterface_opensADocument_andCapturesEveryPacket', async () => {
    const id: string = captures.watchInterface('en0', 'Wi-Fi');
    await fixture.whenStable();

    expect(fixture.debugElement.injector.get(DockPanelRegistry).get(id)?.title).toBe(
      'Capture on Wi-Fi (en0)',
    );
    expect(client.started[0].source).toBe('en0');
    expect(capture(id)?.status).toBe('capturing');
  });

  it('watchConnection_filtersToTheRemoteEnd_withoutItsZone', () => {
    captures.watchConnection('en7', 'fe80::1%en7', 49253);

    expect(client.started[0].source).toBe('en7 host fe80::1 and port 49253');
  });

  it('packets_areKeptInOrder_withTheirCountAndBytes', async () => {
    const id: string = captures.watchInterface('en0', 'en0');
    await fixture.whenStable();
    const before: number = captures.version();

    client.started[0].listener.packets([row(1, 100), row(2, 50)]);
    client.started[0].listener.packets([row(3, 10)]);

    expect(captures.rows(id).map((entry: CapturedPacketRow): number => entry.number)).toEqual([
      1, 2, 3,
    ]);
    expect(capture(id)?.count).toBe(3);
    expect(capture(id)?.bytes).toBe(160);
    expect(captures.version()).toBeGreaterThan(before);
  });

  it('aCaptureWithoutPermission_failsSayingSo', async () => {
    client.answer = { kind: 'failed', message: 'Permission denied', permission: true };

    const id: string = captures.watchInterface('en0', 'en0');
    await fixture.whenStable();

    expect(capture(id)).toEqual(
      expect.objectContaining({ status: 'failed', message: 'Permission denied', permission: true }),
    );
  });

  it('stop_endsTheCapture_andRestartBeginsAgainFromNothing', async () => {
    const id: string = captures.watchInterface('en0', 'en0');
    await fixture.whenStable();
    client.started[0].listener.packets([row(1)]);

    captures.stop(id);
    expect(capture(id)?.status).toBe('stopped');

    captures.restart(id);
    await fixture.whenStable();

    expect(client.calls).toContain(`release ${id}`);
    expect(client.started).toHaveLength(2);
    expect(captures.rows(id)).toEqual([]);
    expect(capture(id)?.status).toBe('capturing');
  });

  it('openFile_readsTheFile_namedForIt', async () => {
    const id: string = captures.openFile('/Users/me/Captures/handshake.pcap');
    await fixture.whenStable();

    expect(capture(id)?.title).toBe('handshake.pcap');
    expect(capture(id)?.status).toBe('reading');

    client.started[0].listener.ended(undefined);
    expect(capture(id)?.status).toBe('stopped');
  });

  it('closingTheTab_releasesEveryCapture', () => {
    const first: string = captures.watchInterface('en0', 'en0');
    const second: string = captures.openFile('/tmp/a.pcap');

    fixture.destroy();

    expect(client.calls).toEqual([`release ${first}`, `release ${second}`]);
  });
});
