import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { ExportPdfResult, PrintChannel, PrintPage } from '@shared/api/print-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { Printing } from './printing';
import { resolvePageSize } from './print-page';

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
    document.documentElement.removeAttribute('data-print-backgrounds');
    document.documentElement.removeAttribute('data-print-syntax');
  });

  /**
   * Pins the paper to A4 so the page rule does not depend on the test machine's locale.
   */
  function useA4(): void {
    TestBed.inject(Settings).set('printing.paperSize', 'a4');
  }

  it('pageRule_isWrittenFromTheMarginEachPrintIsGiven', async () => {
    // Each capability that prints has its own margin, so the rule follows the caller, not one setting.
    useA4();
    vi.stubGlobal('print', vi.fn());
    try {
      const printing: Printing = TestBed.inject(Printing);
      await printing.print('notes.md', 'narrow');
      expect(pageRule()).toBe('@page { size: A4 portrait; margin: 1.4cm 1cm; }');

      await printing.print('notes.md', 'wide');
      expect(pageRule()).toBe('@page { size: A4 portrait; margin: 5.6cm 4cm; }');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('pageRule_followsThePaperSizeAndOrientation', async () => {
    stubBridge({ success: true });
    const settings: Settings = TestBed.inject(Settings);
    settings.set('printing.paperSize', 'legal');
    settings.set('printing.orientation', 'landscape');

    await TestBed.inject(Printing).print('notes.md', 'regular');

    expect(pageRule()).toBe('@page { size: Legal landscape; margin: 2.8cm 2cm; }');
  });

  it('exportPdf_writesThePageRuleBeforeRendering', async () => {
    useA4();
    stubBridge({ success: true });
    await TestBed.inject(Printing).exportPdf('notes.md', 'narrow');

    expect(pageRule()).toBe('@page { size: A4 portrait; margin: 1.4cm 1cm; }');
  });

  it('print_withoutTheBridge_opensTheBrowserPrintDialog', async () => {
    const printSpy: ReturnType<typeof vi.fn> = vi.fn();
    vi.stubGlobal('print', printSpy);
    try {
      await TestBed.inject(Printing).print('notes.md', 'regular');

      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('print_withTheBridge_asksTheMainProcessWithTheFileNameInTheHeader', async () => {
    useA4();
    stubBridge({ success: true });

    await TestBed.inject(Printing).print('notes.md', 'regular');

    const page: PrintPage = {
      pageSize: 'A4',
      landscape: false,
      printBackground: false,
      headerTitle: 'notes.md',
    };
    expect(invokes).toEqual([{ channel: PrintChannel.Print, args: [{ page }] }]);
  });

  it('print_whenHeaderAndFooterAreOff_namesNoHeader', async () => {
    stubBridge({ success: true });
    TestBed.inject(Settings).set('printing.headerAndFooter', false);

    await TestBed.inject(Printing).print('notes.md', 'regular');

    expect((invokes[0].args[0] as { page: PrintPage }).page.headerTitle).toBeUndefined();
  });

  it('print_flagsBackgroundsAndSyntaxColoursForThePrintStylesheet', async () => {
    stubBridge({ success: true });
    const settings: Settings = TestBed.inject(Settings);
    settings.set('printing.backgroundColours', true);
    settings.set('printing.syntaxColours', false);
    settings.set('printing.fontSize', 12);

    await TestBed.inject(Printing).print('notes.md', 'regular');

    const root: HTMLElement = document.documentElement;
    expect(root.hasAttribute('data-print-backgrounds')).toBe(true);
    expect(root.hasAttribute('data-print-syntax')).toBe(false);
    expect(root.style.getPropertyValue('--print-code-font-size')).toBe('12pt');
    expect((invokes[0].args[0] as { page: PrintPage }).page.printBackground).toBe(true);
  });

  it('print_runsEachPreparerBeforeAndReleasesItAfter', async () => {
    const order: string[] = [];
    const invoke: Bridge['invoke'] = <T>(): Promise<T> => {
      order.push('print');
      return Promise.resolve({ success: true } as T);
    };
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke,
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    const printing: Printing = TestBed.inject(Printing);
    printing.registerPreparer((): (() => void) => {
      order.push('prepare');
      return (): void => void order.push('release');
    });

    await printing.print('notes.md', 'regular');

    expect(order).toEqual(['prepare', 'print', 'release']);
  });

  it('print_whenAPreparerThrows_stillPrints', async () => {
    stubBridge({ success: true });
    const printing: Printing = TestBed.inject(Printing);
    printing.registerPreparer((): void => {
      throw new Error('broken');
    });

    await printing.print('notes.md', 'regular');

    expect(invokes.length).toBe(1);
  });

  it('registerPreparer_whenUnregistered_noLongerRuns', async () => {
    stubBridge({ success: true });
    const printing: Printing = TestBed.inject(Printing);
    const preparer: ReturnType<typeof vi.fn<() => void>> = vi.fn<() => void>();
    const unregister: () => void = printing.registerPreparer(preparer);
    unregister();

    await printing.print('notes.md', 'regular');

    expect(preparer).not.toHaveBeenCalled();
  });

  it('exportPdf_whenTheBridgeIsPresent_forwardsTheSeededPdfFileName', async () => {
    const outcome: ExportPdfResult = { success: true, path: '/out/notes.pdf' };
    useA4();
    stubBridge(outcome);
    const printing: Printing = TestBed.inject(Printing);

    const result: ExportPdfResult = await printing.exportPdf('notes.md', 'regular');

    const page: PrintPage = {
      pageSize: 'A4',
      landscape: false,
      printBackground: false,
      headerTitle: 'notes.md',
    };
    expect(invokes).toEqual([
      {
        channel: PrintChannel.ExportPdf,
        args: [{ defaultFileName: 'notes.pdf', page, openAfterExport: true }],
      },
    ]);
    expect(result).toEqual(outcome);
  });

  it('exportPdf_whenOpenAfterExportIsOff_asksForTheFileToStayClosed', async () => {
    stubBridge({ success: true });
    TestBed.inject(Settings).set('printing.openPdfAfterExport', false);

    await TestBed.inject(Printing).exportPdf('notes.md', 'regular');

    expect((invokes[0].args[0] as { openAfterExport: boolean }).openAfterExport).toBe(false);
  });

  it('exportPdf_whenTheDocumentIsUnnamed_fallsBackToAGenericFileName', async () => {
    stubBridge({ success: true });
    const printing: Printing = TestBed.inject(Printing);

    await printing.exportPdf('   ', 'regular');

    expect((invokes[0].args[0] as { defaultFileName: string }).defaultFileName).toBe(
      'document.pdf',
    );
  });

  it('exportPdf_whenTheBridgeIsAbsent_reportsFailure', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const printing: Printing = TestBed.inject(Printing);

    const result: ExportPdfResult = await printing.exportPdf('notes.md', 'regular');

    expect(result.success).toBe(false);
    expect(result.error).toBe('PDF export is only available in the desktop app');
  });
});

describe('resolvePageSize', () => {
  it('resolvePageSize_whenChosen_isThatPaper', () => {
    expect(resolvePageSize('a3', 'en-US')).toBe('A3');
    expect(resolvePageSize('letter', 'en-GB')).toBe('Letter');
  });

  it('resolvePageSize_whenSystem_isLetterInLetterRegions', () => {
    expect(resolvePageSize('system', 'en-US')).toBe('Letter');
    expect(resolvePageSize('system', 'fr-CA')).toBe('Letter');
    expect(resolvePageSize('system', 'es-MX')).toBe('Letter');
  });

  it('resolvePageSize_whenSystem_isA4Elsewhere', () => {
    expect(resolvePageSize('system', 'en-GB')).toBe('A4');
    expect(resolvePageSize('system', 'de')).toBe('A4');
    expect(resolvePageSize('system', 'ja-JP')).toBe('A4');
  });

  it('resolvePageSize_whenTheLocaleCannotBeParsed_isA4', () => {
    expect(resolvePageSize('system', '!!')).toBe('A4');
  });
});
