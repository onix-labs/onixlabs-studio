import { CodeListing } from '@shared/api/code-listing';
import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { WorkspaceChannel } from '@shared/api/workspace-channels';
import {
  BinaryEditOp,
  BinaryVisibleRange,
} from '@shared/angular/components/binary-editor/binary-editor';
import { Tab } from '@shared/angular/services/tabs/tab';
import { BinaryContext, BinaryStatus } from '../binary-status/binary-status';
import { BinaryDocumentEntry, BinaryDocuments } from '../binary-document/binary-document';
import { BinaryPanels } from '../binary-panels/binary-panels';
import { BinaryView } from './binary-view';

/**
 * Exposes the protected handlers the composed hex grid's outputs are wired to, so the view's
 * document plumbing can be exercised directly.
 */
interface BinaryViewInternals {
  onVisibleRange(range: BinaryVisibleRange): void;
  onOp(op: BinaryEditOp): void;
  onUnitSelect(offset: number): void;
}

/**
 * Holds the backing file the fake bridge serves: 200 000 bytes (spanning several 64 KiB blocks)
 * where each byte is its offset modulo 256.
 */
const FILE: Uint8Array = new Uint8Array(200000);
for (let index: number = 0; index < FILE.length; index += 1) {
  FILE[index] = index % 256;
}

/**
 * Builds a fake transport whose read-bytes channel serves clamped windows of {@link FILE}.
 * @returns Returns the fake bridge.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      if (channel === (WorkspaceChannel.ReadBytes as string)) {
        const [, offset, length] = args as [string, number, number];
        const start: number = Math.min(offset, FILE.length);
        const end: number = Math.min(start + length, FILE.length);
        return Promise.resolve({
          size: FILE.length,
          offset: start,
          bytes: FILE.slice(start, end),
        } as T);
      }
      return Promise.resolve(null as T);
    },
    send: (): void => undefined,
    on: (): (() => void) => (): void => undefined,
  };
}

/**
 * Flushes pending microtasks so an in-flight byte-window read settles.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('BinaryView', () => {
  let documents: BinaryDocuments;
  let panels: BinaryPanels;

  beforeEach(async () => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    await TestBed.configureTestingModule({
      imports: [BinaryView],
    }).compileComponents();
    documents = TestBed.inject(BinaryDocuments);
    panels = TestBed.inject(BinaryPanels);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Opens a binary document and creates the view over its tab.
   * @param isActive Whether the view belongs to the active tab.
   * @returns Returns the settled fixture and the backing document.
   */
  async function createView(isActive: boolean = true): Promise<{
    fixture: ComponentFixture<BinaryView>;
    document: BinaryDocumentEntry;
    tab: Tab;
  }> {
    const tab: Tab = documents.open('/ws/blob.bin');
    const fixture: ComponentFixture<BinaryView> = TestBed.createComponent(BinaryView);
    fixture.componentRef.setInput('tabId', tab.id);
    fixture.componentRef.setInput('isActive', isActive);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, document: documents.get(tab.id)!, tab };
  }

  it('render_showsTheHexGridForTheDocument', async () => {
    const { fixture } = await createView();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-binary-editor')).not.toBeNull();
    expect(host.querySelector('app-panel-layout')).not.toBeNull();
  });

  it('render_withoutABackingDocument_rendersNothing', async () => {
    const fixture: ComponentFixture<BinaryView> = TestBed.createComponent(BinaryView);
    fixture.componentRef.setInput('tabId', 'no-such-tab');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-panel-layout')).toBeNull();
  });

  it('status_publishesThePathAndSizeToTheViewsOwnStatus', async () => {
    const { fixture } = await createView(true);

    // The view's status is scoped to its own injector: the strip mounts it only for the active tab
    // and destroys it on a tab switch, so the view publishes regardless of activation.
    const context: BinaryContext | null = fixture.debugElement.injector.get(BinaryStatus).context();

    expect(context?.path).toBe('/ws/blob.bin');
    expect(context?.size).toBe(FILE.length);
  });

  it('onVisibleRange_loadsTheReportedByteWindow', async () => {
    const { fixture, document } = await createView();
    const internals: BinaryViewInternals =
      fixture.componentInstance as unknown as BinaryViewInternals;
    expect(document.byteAt(70000)).toBeNull();

    internals.onVisibleRange({ offset: 70000, length: 16 });
    await flush();

    expect(document.byteAt(70000)).toBe(70000 % 256);
  });

  it('onOp_appliesTypedEditsToTheDocument', async () => {
    const { fixture, document } = await createView();
    const internals: BinaryViewInternals =
      fixture.componentInstance as unknown as BinaryViewInternals;

    internals.onOp({ kind: 'overwrite', offset: 2, value: 0xab });
    expect(document.byteAt(2)).toBe(0xab);
    expect(document.dirty()).toBe(true);

    internals.onOp({ kind: 'insert', offset: 0, value: 0xff });
    expect(document.size()).toBe(FILE.length + 1);

    internals.onOp({ kind: 'delete', offset: 0, count: 1 });
    expect(document.size()).toBe(FILE.length);
  });

  it('onUnitSelect_snapsTheSelectionToTheCoveringInstruction', async () => {
    const { fixture, document } = await createView();
    const internals: BinaryViewInternals =
      fixture.componentInstance as unknown as BinaryViewInternals;
    document.listing.set(listingOf([{ offset: 10, length: 3, mnemonic: 'mov' }]));

    internals.onUnitSelect(11);

    expect(document.selection()).toEqual({ start: 10, end: 13 });
    expect(document.cursor()).toBe(10);
  });

  it('panels_mountIntoTheLayoutWhenToggledOn', async () => {
    const { fixture, tab } = await createView();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-binary-inspector')).toBeNull();

    panels.toggle(tab.id, 'inspector');
    await fixture.whenStable();

    expect(host.querySelector('app-binary-inspector')).not.toBeNull();
  });

  it('destroy_releasesTheDocumentAndPanelState', async () => {
    const { fixture, tab } = await createView(true);
    panels.toggle(tab.id, 'inspector');
    await fixture.whenStable();

    fixture.destroy();
    TestBed.inject(ApplicationRef).tick();

    expect(documents.get(tab.id)).toBeUndefined();
    expect(panels.isMounted(tab.id, 'inspector')).toBe(false);
  });
});

/**
 * Builds a decoder-shaped listing over some instructions, for tests that need the document to have
 * decoded something.
 * @param rows The instructions, as offset/length/mnemonic triples.
 * @returns Returns the listing.
 */
function listingOf(
  rows: readonly { offset: number; length: number; mnemonic: string }[],
): CodeListing {
  return {
    language: 'x64',
    addressing: 'file-offset',
    origin: { kind: 'buffer', path: null },
    sections: [
      {
        id: 'native',
        title: '',
        rows: rows.map((row) => ({
          kind: 'instruction' as const,
          address: row.offset,
          fileOffset: row.offset,
          bytes: new Array<number>(row.length).fill(0),
          mnemonic: row.mnemonic,
          operands: '',
        })),
      },
    ],
  };
}
