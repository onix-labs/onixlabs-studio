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

  /**
   * The TCP destination port's offset: after Ethernet's 14 bytes, IPv4's 20 and the source port's 2.
   */
  const destinationPortOffset: number = 36;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PacketDetails] }).compileComponents();
    fixture = TestBed.createComponent(PacketDetails);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Shows a packet.
   * @param bytes The packet's bytes.
   */
  async function show(bytes: Uint8Array = data): Promise<void> {
    fixture.componentRef.setInput('packet', dissectPacket(LINKTYPE_ETHERNET, bytes));
    fixture.componentRef.setInput('data', bytes);
    await fixture.whenStable();
  }

  /**
   * Gets the dissection tree's rows.
   * @returns Returns them, in order.
   */
  function treeRows(): readonly HTMLElement[] {
    return Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="packet-layers"] [role="treeitem"]'),
    );
  }

  /**
   * Finds the tree row whose text contains some text.
   * @param text The text.
   * @returns Returns the row, or undefined.
   */
  function rowWith(text: string): HTMLElement | undefined {
    return treeRows().find((row: HTMLElement): boolean => row.textContent.includes(text));
  }

  /**
   * Gets the bytes view's hex cells.
   * @returns Returns them, in offset order.
   */
  function hexCells(): readonly HTMLElement[] {
    return Array.from(
      host.querySelectorAll<HTMLElement>(
        '[data-testid="packet-hex"] .binary-editor__hexcell:not(.binary-editor__hexcell--header)',
      ),
    );
  }

  /**
   * Gets the selected bytes in the hex column.
   * @returns Returns them, as lower-case hex.
   */
  function highlighted(): readonly string[] {
    return hexCells()
      .filter((cell: HTMLElement): boolean =>
        cell.classList.contains('binary-editor__cell--selected'),
      )
      .map((cell: HTMLElement): string => cell.textContent.trim().toLowerCase());
  }

  /**
   * Presses the pointer on a byte in the hex column, as selecting it begins.
   * @param offset The byte's offset.
   */
  function press(offset: number): void {
    hexCells()[offset]?.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
    );
  }

  it('asksForAPacket_untilOneIsChosen', async () => {
    await fixture.whenStable();

    expect(host.querySelector('[data-testid="packet-details-empty"]')?.textContent).toContain(
      'Choose a packet',
    );
    expect(host.querySelector('[data-testid="packet-layers"]')).toBeNull();
    expect(host.querySelector('[data-testid="packet-hex"]')).toBeNull();
  });

  it('showsEachLayerOpen_withItsFields', async () => {
    await show();

    const layers: readonly string[] = Array.from(
      host.querySelectorAll('[data-testid="packet-layer"]'),
    ).map((layer: Element): string => layer.textContent.trim());
    expect(layers[2]).toBe('Transmission Control Protocol, 50000 → 443, Len: 0');
    expect(rowWith('Transmission Control Protocol')?.getAttribute('aria-expanded')).toBe('true');
    expect(rowWith('Destination Port:')).toBeDefined();
  });

  it('showsEveryByte_inTheBytesView', async () => {
    await show();

    expect(hexCells()).toHaveLength(data.length);
    expect(highlighted()).toEqual([]);
  });

  it('choosingAField_selectsItsRow_andHighlightsItsBytes', async () => {
    await show();

    rowWith('Destination Port')?.click();
    await fixture.whenStable();

    // Port 443 is 0x01bb.
    expect(highlighted()).toEqual(['01', 'bb']);
    expect(rowWith('Destination Port')?.getAttribute('aria-selected')).toBe('true');
  });

  it('choosingALayer_collapsesIt_andHighlightsItsBytes', async () => {
    await show();

    const before: number = treeRows().length;
    const ethernetFields: number =
      dissectPacket(LINKTYPE_ETHERNET, data).layers[0]?.fields.length ?? 0;

    rowWith('Ethernet II')?.click();
    await fixture.whenStable();

    expect(rowWith('Ethernet II')?.getAttribute('aria-expanded')).toBe('false');
    expect(treeRows()).toHaveLength(before - ethernetFields);
    expect(highlighted()).toHaveLength(data.length);
  });

  it('choosingACollapsedLayer_opensItAgain', async () => {
    await show();

    rowWith('Transmission Control Protocol')?.click();
    await fixture.whenStable();
    rowWith('Transmission Control Protocol')?.click();
    await fixture.whenStable();

    expect(rowWith('Transmission Control Protocol')?.getAttribute('aria-expanded')).toBe('true');
    expect(rowWith('Destination Port:')).toBeDefined();
  });

  it('selectingAByte_choosesTheFieldItLiesIn', async () => {
    await show();

    press(destinationPortOffset);
    await fixture.whenStable();

    expect(highlighted()).toEqual(['01']);
    expect(rowWith('Destination Port')?.getAttribute('aria-selected')).toBe('true');
  });

  it('selectingAByteOfACollapsedLayer_choosesTheLayer', async () => {
    await show();
    rowWith('Transmission Control Protocol')?.click();
    await fixture.whenStable();
    press(0);
    await fixture.whenStable();

    press(destinationPortOffset);
    await fixture.whenStable();

    expect(rowWith('Transmission Control Protocol')?.getAttribute('aria-selected')).toBe('true');
  });

  it('choosingAnotherPacket_clearsTheSelection', async () => {
    await show();
    rowWith('Destination Port')?.click();
    await fixture.whenStable();

    await show(data.slice());

    expect(highlighted()).toEqual([]);
    expect(
      treeRows().some((row: HTMLElement): boolean => row.getAttribute('aria-selected') === 'true'),
    ).toBe(false);
  });
});
