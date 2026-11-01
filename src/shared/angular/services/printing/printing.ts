import { DOCUMENT, inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { ExportPdfRequest, ExportPdfResult, PrintChannel } from '@shared/api/print-channels';
import { Log } from '@shared/angular/services/log/log';
import type { PrintMargin } from '@shared/angular/services/settings/settings';

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
 * Prints the active document, or exports it to PDF, with the margin its capability's settings choose.
 *
 * The page margin belongs in an `@page` rule, but Chromium does not reliably honour a CSS custom
 * property inside `@page`, so the rule text cannot be driven by a projected variable the way the theme
 * colours are. Instead this service owns a single `<style>` element whose `@page` rule is rewritten
 * immediately before each print — the one authoritative source of the print margin (the print
 * stylesheet deliberately declares none). The margin is the caller's: each capability that prints
 * (code, Markdown) has its own, so there is no one margin to keep in sync.
 */
@Service()
export class Printing {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
   * Holds the style element carrying the `@page` margin rule.
   */
  private readonly styleElement: HTMLStyleElement = this.document.createElement('style');

  /**
   * Initialises the service, placing the `@page` style element the margin is written into.
   */
  public constructor() {
    this.styleElement.dataset['printMargin'] = '';
    this.document.head.appendChild(this.styleElement);
  }

  /**
   * Prints the active document through the browser print dialog, which applies the print stylesheet
   * and the `@page` margin.
   * @param margin The page margin the printing capability's settings choose.
   */
  public print(margin: PrintMargin): void {
    this.log.info('Printing', 'Printing active document', margin);
    this.applyMargin(margin);
    this.document.defaultView?.print();
  }

  /**
   * Exports the active document to a PDF, prompting the user for a destination through the main
   * process. The rendered PDF applies the same print stylesheet and margin as {@link print}. Degrades
   * to a no-op reporting failure outside Electron, where no bridge is available.
   * @param documentName The active document's name (for example `notes.md`); its extension is swapped
   * for `.pdf` to seed the save dialog.
   * @param margin The page margin the printing capability's settings choose.
   * @returns Returns the outcome describing success, cancellation, or failure.
   */
  public async exportPdf(documentName: string, margin: PrintMargin): Promise<ExportPdfResult> {
    this.applyMargin(margin);
    const request: ExportPdfRequest = { defaultFileName: this.toPdfFileName(documentName) };
    this.log.info('Printing', 'Exporting document to PDF', request.defaultFileName);
    const result: ExportPdfResult = (await this.bridge?.invoke<ExportPdfResult>(
      PrintChannel.ExportPdf,
      request,
    )) ?? {
      success: false,
      error: 'PDF export is only available in the desktop app',
    };
    this.log.debug('Printing', 'PDF export completed', result.success);
    return result;
  }

  /**
   * Writes the `@page` margin rule for the print about to happen.
   * @param margin The page margin.
   */
  private applyMargin(margin: PrintMargin): void {
    this.styleElement.textContent = `@page { margin: ${PRINT_MARGINS[margin]}; }`;
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
