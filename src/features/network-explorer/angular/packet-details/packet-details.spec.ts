import { ComponentFixture, TestBed } from '@angular/core/testing';
import { dissectPacket } from '@shared/api/packets/dissect-packet';
import { LINKTYPE_ETHERNET } from '@shared/api/packets/packet-model';
import {
  ethernet,
  hostMac,
  ipv4,
  routerMac,
  tcp,
} from '@shared/api/packets/packet-samples.testing';
import { PacketDetails } from './packet-details';

describe('PacketDetails', () => {
  let fixture: ComponentFixture<PacketDetails>;
  let host: HTMLElement;
  const data: Uint8Array = ethernet(
    hostMac,
    routerMac,
    0x0800,
    ipv4('192.168.1.43', '140.82.112.3', 6, tcp(50000, 443, 0x02)),
  );

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PacketDetails] }).compileComponents();
    fixture = TestBed.createComponent(PacketDetails);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Shows the sample packet.
   */
  async function show(): Promise<void> {
    fixture.componentRef.setInput('packet', dissectPacket(LINKTYPE_ETHERNET, data));
    fixture.componentRef.setInput('data', data);
    await fixture.whenStable();
  }

  /**
   * Gets the highlighted bytes in the hex column.
   * @returns Returns them, as hex.
   */
  function highlighted(): readonly string[] {
    return Array.from(host.querySelectorAll('.details__hex-bytes .details__byte--on')).map(
      (byte: Element): string => byte.textContent,
    );
  }

  it('asksForAPacket_untilOneIsChosen', async () => {
    await fixture.whenStable();

    expect(host.textContent).toContain('Choose a packet');
  });

  it('showsEachLayerOpen_andTheBytesInLinesOfSixteen', async () => {
    await show();

    const summaries: readonly string[] = Array.from(
      host.querySelectorAll('.details__layer-summary'),
    ).map((summary: Element): string => summary.textContent.replace('▸', '').trim());
    expect(summaries[2]).toBe('Transmission Control Protocol, 50000 → 443, Len: 0');
    expect(host.querySelectorAll('.details__hex-line')).toHaveLength(Math.ceil(data.length / 16));
    expect(host.textContent).toContain('Destination Port:');
  });

  it('choosingAField_highlightsItsBytes', async () => {
    await show();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.details__field'))
      .find((button: HTMLButtonElement): boolean => button.textContent.includes('Destination Port'))
      ?.click();
    await fixture.whenStable();

    // Port 443 is 0x01bb.
    expect(highlighted()).toEqual(['01', 'bb']);
  });

  it('choosingALayer_collapsesIt_andHighlightsItsBytes', async () => {
    await show();

    host.querySelectorAll<HTMLButtonElement>('.details__layer-summary')[0].click();
    await fixture.whenStable();

    expect(host.querySelectorAll('.details__layer-summary')[0].getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(highlighted()).toHaveLength(data.length);
  });
});
