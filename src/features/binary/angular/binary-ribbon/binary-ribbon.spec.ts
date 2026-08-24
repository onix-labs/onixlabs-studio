import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { WorkspaceChannel } from '@shared/api/workspace-channels';
import { Tab } from '@shared/angular/services/tabs/tab';
import { BinaryDocumentEntry, BinaryDocuments } from '../binary-document/binary-document';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { BinaryPanels } from '../binary-panels/binary-panels';
import { BinaryRibbon } from './binary-ribbon';

/**
 * Exposes the protected members the ribbon's controls are wired to, so their behaviour can be
 * exercised directly.
 */
interface BinaryRibbonInternals {
  rowWidthValue(): string;
  dirty(): boolean;
  inspectorShown(): boolean;
  onRowWidthChange(value: string): void;
  onToggleInspector(): void;
  onGoToEnd(): void;
  onCopy(): Promise<void>;
}

/**
 * Holds the backing file the fake bridge serves: 100 bytes where each byte is its offset.
 */
const FILE: Uint8Array = new Uint8Array(100);
for (let index: number = 0; index < FILE.length; index += 1) {
  FILE[index] = index;
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

describe('BinaryRibbon', () => {
  let internals: BinaryRibbonInternals;
  let fixture: ComponentFixture<BinaryRibbon>;
  let documents: BinaryDocuments;
  let panels: BinaryPanels;

  beforeEach(async () => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    await TestBed.configureTestingModule({
      imports: [BinaryRibbon],
    }).compileComponents();

    documents = TestBed.inject(BinaryDocuments);
    panels = TestBed.inject(BinaryPanels);
    fixture = TestBed.createComponent(BinaryRibbon);
    internals = fixture.componentInstance as unknown as BinaryRibbonInternals;
    await fixture.whenStable();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Opens a binary document, which also activates its tab, and waits for its first block to load.
   * @returns Returns the opened document entry.
   */
  async function openDocument(): Promise<BinaryDocumentEntry> {
    const tab: Tab = documents.open('/ws/data.bin');
    await flush();
    return documents.get(tab.id)!;
  }

  it('rowWidthValue_withoutAnActiveBinaryTab_fallsBackToSixteen', () => {
    expect(internals.rowWidthValue()).toBe('16');
    expect(internals.dirty()).toBe(false);
  });

  it('onRowWidthChange_setsTheActiveDocumentsBytesPerRow', async () => {
    const document: BinaryDocumentEntry = await openDocument();

    internals.onRowWidthChange('32');
    expect(document.bytesPerRow()).toBe(32);

    // A non-integer value is ignored.
    internals.onRowWidthChange('wide');
    expect(document.bytesPerRow()).toBe(32);
  });

  it('onToggleInspector_togglesThePanelForTheActiveTab', async () => {
    const document: BinaryDocumentEntry = await openDocument();

    expect(internals.inspectorShown()).toBe(false);
    internals.onToggleInspector();
    expect(panels.isVisible(document.tabId, 'inspector')).toBe(true);
    expect(internals.inspectorShown()).toBe(true);
  });

  it('onGoToEnd_revealsTheLastByte', async () => {
    const document: BinaryDocumentEntry = await openDocument();

    internals.onGoToEnd();

    expect(document.cursor()).toBe(FILE.length - 1);
    expect(document.selection()).toEqual({ start: FILE.length - 1, end: FILE.length });
  });

  it('onCopy_writesTheSelectedBytesAsHexPairsToTheClipboard', async () => {
    const copied: string[] = [];
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    );
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string): Promise<void> => {
          copied.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
    try {
      const document: BinaryDocumentEntry = await openDocument();
      document.selection.set({ start: 1, end: 4 });

      await internals.onCopy();

      expect(copied).toEqual(['01 02 03']);
    } finally {
      if (descriptor === undefined) {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      } else {
        Object.defineProperty(navigator, 'clipboard', descriptor);
      }
    }
  });

  it('navigationButtons_whenPressed_moveThroughTheFile', async () => {
    const document: BinaryDocumentEntry = await openDocument();
    fixture.detectChanges();

    button('End').click();
    expect(document.cursor()).toBe(FILE.length - 1);

    button('Start').click();
    expect(document.cursor()).toBe(0);
  });

  it('panelButtons_whenPressed_toggleTheirPanelsForTheActiveTab', async () => {
    const document: BinaryDocumentEntry = await openDocument();
    fixture.detectChanges();

    button('Inspector').click();
    button('Agent').click();

    expect(panels.isVisible(document.tabId, 'inspector')).toBe(true);
    expect(panels.isVisible(document.tabId, 'agent')).toBe(true);
  });

  it('insertButton_whenPressed_flipsBetweenInsertAndOverwrite', async () => {
    const document: BinaryDocumentEntry = await openDocument();
    fixture.detectChanges();
    expect(document.insertMode()).toBe(false);

    button('Insert').click();

    expect(document.insertMode()).toBe(true);
  });

  it('menu_whenACommandIsChosen_runsTheSameHandlerAsTheRibbon', async () => {
    const document: BinaryDocumentEntry = await openDocument();
    fixture.detectChanges();
    TestBed.tick();
    const menu: AppMenu = TestBed.inject(AppMenu);

    menu.dispatch('binary.goToEnd');
    expect(document.cursor()).toBe(FILE.length - 1);

    menu.dispatch('binary.goToStart');
    expect(document.cursor()).toBe(0);

    menu.dispatch('binary.insertMode');
    expect(document.insertMode()).toBe(true);

    menu.dispatch('binary.inspector');
    menu.dispatch('binary.disassembly');
    menu.dispatch('binary.agent');
    expect(panels.isVisible(document.tabId, 'inspector')).toBe(true);
    expect(panels.isVisible(document.tabId, 'disassembly')).toBe(true);
    expect(panels.isVisible(document.tabId, 'agent')).toBe(true);
  });

  it('commands_whenNoBinaryTabIsActive_doNothingRatherThanThrow', () => {
    // The ribbon outlives any one document, so every handler has to tolerate there being none.
    TestBed.tick();
    const menu: AppMenu = TestBed.inject(AppMenu);

    expect((): void => {
      menu.dispatch('binary.undo');
      menu.dispatch('binary.redo');
      menu.dispatch('binary.goToStart');
      menu.dispatch('binary.goToEnd');
      menu.dispatch('binary.goToCode');
      menu.dispatch('binary.insertMode');
      menu.dispatch('binary.inspector');
    }).not.toThrow();
  });

  /**
   * Finds a ribbon button by its visible label.
   * @param label The button label.
   * @returns Returns the matching button element.
   */
  function button(label: string): HTMLButtonElement {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const match: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }
});
