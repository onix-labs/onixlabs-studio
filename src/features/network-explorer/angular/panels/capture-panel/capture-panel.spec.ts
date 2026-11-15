import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { CapturedPacketRow } from '@shared/api/network-capture-channels';
import { LINKTYPE_ETHERNET } from '@shared/api/packets/packet-model';
import {
  dnsQuery,
  ethernet,
  hostMac,
  ipv4,
  routerMac,
  udp,
} from '@shared/api/packets/packet-samples.testing';
import { CaptureClient } from '../../capture-client/capture-client';
import { FakeCaptureClient } from '../../capture-client/capture-client.fake';
import { Capture, NetworkCaptures } from '../../network-captures/network-captures';
import { CapturePanel } from './capture-panel';

/**
 * A stand-in for the tab's captures: one capture and its rows, set by the test, and a record of what
 * it was asked.
 */
class FakeCaptures {
  /**
   * Gets the captures, by id.
   */
  public readonly captures: WritableSignal<ReadonlyMap<string, Capture>> = signal<
    ReadonlyMap<string, Capture>
  >(new Map<string, Capture>());

  /**
   * Gets the change count.
   */
  public readonly version: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the rows.
   */
  public readonly stored: CapturedPacketRow[] = [];

  /**
   * Gets what was asked, in order.
   */
  public readonly calls: string[] = [];

  /**
   * Gets the capture's rows.
   * @returns Returns them.
   */
  public rows(): readonly CapturedPacketRow[] {
    return this.stored;
  }

  /**
   * Records a stop.
   * @param id The capture's id.
   */
  public stop(id: string): void {
    this.calls.push(`stop ${id}`);
  }

  /**
   * Records a restart.
   * @param id The capture's id.
   */
  public restart(id: string): void {
    this.calls.push(`restart ${id}`);
  }

  /**
   * Records a save.
   * @param id The capture's id.
   * @param path The file.
   * @returns Returns true.
   */
  public save(id: string, path: string): Promise<boolean> {
    this.calls.push(`save ${id} ${path}`);
    return Promise.resolve(true);
  }
}

/**
 * A save dialog that always chooses the same file.
 */
class ChoosingFileSystem {
  /**
   * Gets the name the dialog was offered.
   */
  public offered: string | undefined;

  /**
   * Chooses a file.
   * @param defaultPath The name offered.
   * @returns Returns the chosen path.
   */
  public saveDialog(defaultPath?: string): Promise<string | null> {
    this.offered = defaultPath;
    return Promise.resolve('/Users/me/capture.pcap');
  }
}

/**
 * Builds a packet row.
 * @param number The packet's number.
 * @param protocol Its protocol.
 * @param info What it says.
 * @returns Returns the row.
 */
function row(number: number, protocol: string, info: string): CapturedPacketRow {
  return {
    number,
    timestampMs: 1_000 + number * 250,
    length: 74,
    summary: { protocol, source: '192.168.1.43', destination: '192.168.1.1', info },
  };
}

describe('CapturePanel', () => {
  let fixture: ComponentFixture<CapturePanel>;
  let host: HTMLElement;
  let captures: FakeCaptures;
  let client: FakeCaptureClient;
  let files: ChoosingFileSystem;

  beforeEach(async () => {
    // jsdom does not scroll; the list's following the newest packet asks it to.
    if (!('scrollTo' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'scrollTo', {
        value: (): void => undefined,
        configurable: true,
      });
    }
    captures = new FakeCaptures();
    client = new FakeCaptureClient();
    files = new ChoosingFileSystem();
    await TestBed.configureTestingModule({
      imports: [CapturePanel],
      providers: [
        { provide: NetworkCaptures, useValue: captures },
        { provide: CaptureClient, useValue: client },
        { provide: FileSystem, useValue: files },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CapturePanel);
    fixture.componentRef.setInput('panel', {
      id: 'capture-1',
      title: 'Capture',
      icon: Icon.NETWORK_CAPTURE,
      role: 'document',
      component: CapturePanel,
    } satisfies DockPanel);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Shows a capture with rows.
   * @param capture The capture's fields that differ from a running capture of en0.
   * @param rows Its rows.
   */
  async function show(
    capture: Partial<Capture>,
    rows: readonly CapturedPacketRow[] = [],
  ): Promise<void> {
    captures.stored.push(...rows);
    captures.captures.set(
      new Map<string, Capture>([
        [
          'capture-1',
          {
            id: 'capture-1',
            title: 'Capture on Wi-Fi (en0)',
            source: { kind: 'interface', interfaceId: 'en0', filter: '' },
            status: 'capturing',
            permission: false,
            count: rows.length,
            bytes: rows.length * 74,
            ...capture,
          },
        ],
      ]),
    );
    captures.version.update((version: number): number => version + 1);
    await fixture.whenStable();
  }

  /**
   * Gets the packet rows drawn.
   * @returns Returns their info column.
   */
  function drawnInfo(): readonly string[] {
    return Array.from(
      host.querySelectorAll('.capture__row:not(.capture__row--header) .capture__info'),
    ).map((cell: Element): string => cell.textContent.trim());
  }

  /**
   * Clicks a strip button by its label.
   * @param label The label.
   */
  function click(label: string): void {
    Array.from(host.querySelectorAll<HTMLButtonElement>('app-panel-toolbar button'))
      .find((button: HTMLButtonElement): boolean => button.textContent.trim() === label)
      ?.click();
  }

  it('showsTheCaptureAndItsTotals', async () => {
    await show({}, [row(1, 'DNS', 'Standard query'), row(2, 'TCP', '[SYN]')]);

    expect(host.querySelector('[data-testid="capture-title"]')?.textContent).toBe(
      'Capture on Wi-Fi (en0)',
    );
    expect(host.querySelector('[data-testid="capture-status"]')?.textContent?.trim()).toBe(
      'Capturing',
    );
    expect(host.querySelector('[data-testid="capture-totals"]')?.textContent).toBe(
      '2 packets · 148 B',
    );
    expect(drawnInfo()).toEqual(['Standard query', '[SYN]']);
  });

  it('theFilter_narrowsTheRows_andSaysHowManyAreShown', async () => {
    await show({}, [row(1, 'DNS', 'Standard query'), row(2, 'TCP', '[SYN]')]);

    const field: HTMLInputElement = host.querySelector<HTMLInputElement>('app-text-field input')!;
    field.value = 'dns';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(drawnInfo()).toEqual(['Standard query']);
    expect(host.querySelector('[data-testid="capture-totals"]')?.textContent).toBe(
      '2 packets, 1 shown · 148 B',
    );
  });

  it('choosingAPacket_fetchesItsBytes_andTakesItApart', async () => {
    client.packetBytes = {
      linkType: LINKTYPE_ETHERNET,
      data: ethernet(
        hostMac,
        routerMac,
        0x0800,
        ipv4('192.168.1.43', '192.168.1.1', 17, udp(53000, 53, dnsQuery(9, 'github.com'))),
      ),
    };
    await show({}, [row(1, 'DNS', 'Standard query')]);

    host.querySelector<HTMLButtonElement>('.capture__row:not(.capture__row--header)')!.click();
    await fixture.whenStable();

    expect(client.calls).toContain('packet capture-1 1');
    const layers: string = host.querySelector('[data-testid="packet-layers"]')?.textContent ?? '';
    expect(layers).toContain('Domain Name System (query)');
    expect(host.querySelector('[data-testid="packet-hex"]')?.textContent).toContain('0000');
  });

  it('offersStopWhileCapturing_andCaptureAgainOnceStopped', async () => {
    await show({});
    click('Stop');

    await show({ status: 'stopped' });
    click('Capture Again');

    expect(captures.calls).toEqual(['stop capture-1', 'restart capture-1']);
  });

  it('save_offersAPcapNamedForTheCapture', async () => {
    await show({ status: 'stopped' }, [row(1, 'TCP', '[SYN]')]);

    click('Save');
    await fixture.whenStable();

    expect(files.offered).toBe('Capture on Wi-Fi (en0).pcap');
    expect(captures.calls).toEqual(['save capture-1 /Users/me/capture.pcap']);
  });

  it('aCaptureWithoutPermission_explainsHowToGrantIt', async () => {
    await show({
      status: 'failed',
      permission: true,
      message: '(cannot open BPF device) /dev/bpf0: Permission denied',
    });

    const help: string =
      host.querySelector('[data-testid="capture-permission"]')?.textContent ?? '';
    expect(help).toContain('ChmodBPF');
    expect(help).toContain('access_bpf');
    expect(help).toContain('/dev/bpf0: Permission denied');
  });
});
