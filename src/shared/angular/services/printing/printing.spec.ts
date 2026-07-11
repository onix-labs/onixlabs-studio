import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { ExportPdfResult, PrintChannel } from '@shared/api/print-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { Printing } from './printing';

/**
 * A recorded bridge invocation.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('Printing', () => {
  let invokes: RecordedCall[];

  /**
   * Installs a stub bridge on the window that records invocations and resolves with a fixed result.
   * @param result The value every stubbed invoke resolves with.
   */
  function stubBridge(result: unknown): void {
    invokes = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        invokes.push({ channel, args });
        return Promise.resolve(result as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  /**
   * Reads the `@page` rule text of the most recently created print-margin style element.
   * @returns Returns the rule text, or the empty string when no element exists.
   */
  function pageRule(): string {
    const elements: NodeListOf<HTMLStyleElement> = document.head.querySelectorAll(
      'style[data-print-margin]',
    );
    return elements[elements.length - 1]?.textContent ?? '';
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    document.head
      .querySelectorAll('style[data-print-margin]')
      .forEach((element: Element): void => element.remove());
  });

  it('pageRule_whenTheMarginSettingChanges_isRewritten', () => {
    TestBed.inject(Printing);
    const settings: Settings = TestBed.inject(Settings);
    settings.set('application.printMargin', 'narrow');
    TestBed.tick();
    expect(pageRule()).toBe('@page { margin: 1.4cm 1cm; }');

    settings.set('application.printMargin', 'wide');
    TestBed.tick();
    expect(pageRule()).toBe('@page { margin: 5.6cm 4cm; }');
  });

  it('print_whenCalled_opensTheBrowserPrintDialog', () => {
    const printSpy: ReturnType<typeof vi.fn> = vi.fn();
    vi.stubGlobal('print', printSpy);
    try {
      TestBed.inject(Printing).print();

      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('exportPdf_whenTheBridgeIsPresent_forwardsTheSeededPdfFileName', async () => {
    const outcome: ExportPdfResult = { success: true, path: '/out/notes.pdf' };
    stubBridge(outcome);
    const printing: Printing = TestBed.inject(Printing);

    const result: ExportPdfResult = await printing.exportPdf('notes.md');

    expect(invokes).toEqual([
      { channel: PrintChannel.ExportPdf, args: [{ defaultFileName: 'notes.pdf' }] },
    ]);
    expect(result).toEqual(outcome);
  });

  it('exportPdf_whenTheDocumentIsUnnamed_fallsBackToAGenericFileName', async () => {
    stubBridge({ success: true });
    const printing: Printing = TestBed.inject(Printing);

    await printing.exportPdf('   ');

    expect(invokes[0].args).toEqual([{ defaultFileName: 'document.pdf' }]);
  });

  it('exportPdf_whenTheBridgeIsAbsent_reportsFailure', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const printing: Printing = TestBed.inject(Printing);

    const result: ExportPdfResult = await printing.exportPdf('notes.md');

    expect(result.success).toBe(false);
    expect(result.error).toBe('PDF export is only available in the desktop app');
  });
});
