import { DOCUMENT, inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  ExportPdfRequest,
  ExportPdfResult,
  PrintChannel,
  PrintPage,
  PrintRequest,
  PrintResult,
} from '@shared/api/print-channels';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import type { PrintMargin } from '@shared/angular/services/settings/settings';
import { resolvePageSize } from './print-page';

/**
 * Maps each print-margin choice to its `@page` margin value. The values are the vertical then
 * horizontal margins; `regular` doubles `narrow` and `wide` doubles `regular`, so the three steps are a
 * clean progression from a tight margin to a generous one.
 */
const PRINT_MARGINS: Readonly<Record<PrintMargin, string>> = {
  narrow: '1.4cm 1cm',
  regular: '2.8cm 2cm',
  wide: '5.6cm 4cm',
};

/**
 * Readies a document for the print about to happen, such as rendering the full-file mirror a code
 * document prints in place of its virtualised editor, and optionally returns the step that releases
 * what it built once the print is done.
 */
export type PrintPreparer = () => (() => void) | void;

/**
 * Prints the active document, or exports it to PDF, with the margin its capability's settings choose
 * and the page the Application › Printing settings choose.
 *
 * The page margin and size belong in an `@page` rule, but Chromium does not reliably honour a CSS
 * custom property inside `@page`, so the rule text cannot be driven by a projected variable the way
 * the theme colours are. Instead this service owns a single `<style>` element whose `@page` rule is
 * rewritten immediately before each print — the one authoritative source of the page margin and size
 * (the print stylesheet deliberately declares neither). The margin is the caller's: each capability
 * that prints (code, Markdown) has its own, so there is no one margin to keep in sync.
 *
 * In the desktop app the print itself is the main process's, which can put the file name, date and
 * page numbers in the page header and footer; in a browser it falls back to `window.print()`.
 */
@Service()
export class Printing {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings the page is chosen from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the generic transport used to reach the main-process print manager, or undefined when
   * running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the document the `@page` style element is appended to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the style element carrying the `@page` rule.
   */
  private readonly styleElement: HTMLStyleElement = this.document.createElement('style');

  /**
   * Holds the steps that ready documents for a print.
   */
  private readonly preparers: Set<PrintPreparer> = new Set<PrintPreparer>();

  /**
   * Initialises the service, placing the `@page` style element the page rule is written into.
   */
  public constructor() {
    this.styleElement.dataset['printMargin'] = '';
    this.document.head.appendChild(this.styleElement);
  }

  /**
   * Registers a step that readies a document before each print or export.
   * @param preparer The step; it runs before every print and its returned release after.
   * @returns Returns the function that unregisters the step.
   */
  public registerPreparer(preparer: PrintPreparer): () => void {
    this.preparers.add(preparer);
    return (): void => {
      this.preparers.delete(preparer);
    };
  }

  /**
   * Prints the active document through the system print dialog, which applies the print stylesheet
   * and the `@page` rule.
   * @param documentName The active document's name, printed in the page header.
   * @param margin The page margin the printing capability's settings choose.
   * @returns Returns the outcome of the print.
   */
  public async print(documentName: string, margin: PrintMargin): Promise<PrintResult> {
    this.log.info('Printing', 'Printing active document', margin);
    const page: PrintPage = this.applyPage(documentName, margin);
    const release: () => void = this.prepare();
    try {
      if (this.bridge === undefined) {
        this.document.defaultView?.print();
        return { success: true };
      }
      const request: PrintRequest = { page };
      const result: PrintResult = await this.bridge.invoke<PrintResult>(
        PrintChannel.Print,
        request,
      );
      this.log.debug('Printing', 'Print completed', result.success);
      return result;
    } finally {
      release();
    }
  }

  /**
   * Exports the active document to a PDF, prompting the user for a destination through the main
   * process. The rendered PDF applies the same print stylesheet and page as {@link print}. Degrades
   * to a no-op reporting failure outside Electron, where no bridge is available.
   * @param documentName The active document's name (for example `notes.md`); its extension is swapped
   * for `.pdf` to seed the save dialog, and it is printed in the page header.
   * @param margin The page margin the printing capability's settings choose.
   * @returns Returns the outcome describing success, cancellation, or failure.
   */
  public async exportPdf(documentName: string, margin: PrintMargin): Promise<ExportPdfResult> {
    const page: PrintPage = this.applyPage(documentName, margin);
    const request: ExportPdfRequest = {
      defaultFileName: this.toPdfFileName(documentName),
      page,
      openAfterExport: this.settings.get('printing.openPdfAfterExport'),
    };
    this.log.info('Printing', 'Exporting document to PDF', request.defaultFileName);
    const release: () => void = this.prepare();
    try {
      const result: ExportPdfResult = (await this.bridge?.invoke<ExportPdfResult>(
        PrintChannel.ExportPdf,
        request,
      )) ?? {
        success: false,
        error: 'PDF export is only available in the desktop app',
      };
      this.log.debug('Printing', 'PDF export completed', result.success);
      return result;
    } finally {
      release();
    }
  }

  /**
   * Writes the `@page` rule and the print flags for the print about to happen, and describes the page
   * for the main process.
   * @param documentName The document's name, printed in the page header.
   * @param margin The page margin.
   * @returns Returns the page the document is printed on.
   */
  private applyPage(documentName: string, margin: PrintMargin): PrintPage {
    const page: PrintPage = {
      pageSize: resolvePageSize(
        this.settings.get('printing.paperSize'),
        this.document.defaultView?.navigator.language ?? 'en-GB',
      ),
      landscape: this.settings.get('printing.orientation') === 'landscape',
      printBackground: this.settings.get('printing.backgroundColours'),
      headerTitle: this.settings.get('printing.headerAndFooter')
        ? documentName.trim() || 'Untitled'
        : undefined,
    };
    const orientation: string = page.landscape ? 'landscape' : 'portrait';
    this.styleElement.textContent = `@page { size: ${page.pageSize} ${orientation}; margin: ${PRINT_MARGINS[margin]}; }`;

    // The print stylesheet reads these: whether to keep backgrounds and syntax colours, and the size
    // and family printed code is set in (the family is Code's own).
    const root: HTMLElement = this.document.documentElement;
    root.toggleAttribute('data-print-backgrounds', page.printBackground);
    root.toggleAttribute('data-print-syntax', this.settings.get('printing.syntaxColours'));
    root.style.setProperty('--print-code-font-size', `${this.settings.get('printing.fontSize')}pt`);
    root.style.setProperty(
      '--print-code-font-family',
      this.settings.get('textEditor.global.fontFamily'),
    );
    return page;
  }

  /**
   * Runs every registered preparer, collecting what each returns to release afterwards. A preparer
   * that throws is logged and skipped, so one broken document cannot stop the print.
   * @returns Returns the function that releases what the preparers built.
   */
  private prepare(): () => void {
    const releases: (() => void)[] = [];
    for (const preparer of this.preparers) {
      try {
        const release: (() => void) | void = preparer();
        if (release !== undefined) {
          releases.push(release);
        }
      } catch (error: unknown) {
        this.log.warn('Printing', 'A print preparer failed', error);
      }
    }
    return (): void => {
      for (const release of releases) {
        release();
      }
    };
  }

  /**
   * Derives a PDF file name from a document name by replacing its extension, falling back to a generic
   * name when the document is unnamed.
   * @param documentName The document's name.
   * @returns Returns the `.pdf` file name.
   */
  private toPdfFileName(documentName: string): string {
    const base: string = documentName.trim().replace(/\.[^./\\]+$/, '');
    return `${base.length > 0 ? base : 'document'}.pdf`;
  }
}
