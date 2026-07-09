import { DOCUMENT, effect, inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { ExportPdfRequest, ExportPdfResult, PrintChannel } from '@shared/api/print-channels';
import { Settings } from '@shared/angular/services/settings/settings';
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
 * Projects the user's print-margin setting onto the printed page.
 *
 * The page margin belongs in an `@page` rule, but Chromium does not reliably honour a CSS custom
 * property inside `@page`, so the rule text cannot be driven by a projected variable the way the theme
 * colours are. Instead this service owns a single `<style>` element whose `@page` rule is rewritten
 * whenever the setting changes — the one authoritative source of the print margin (the print stylesheet
 * deliberately declares none). Instantiated at start-up so the margin is in place before the first
 * print.
 */
@Service()
export class Printing {
  /**
   * Holds the settings service the print margin is read from.
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
   * Holds the style element carrying the `@page` margin rule.
   */
  private readonly styleElement: HTMLStyleElement = this.document.createElement('style');

  /**
   * Initialises the service, keeping the `@page` margin rule in sync with the setting.
   */
  public constructor() {
    this.styleElement.dataset['printMargin'] = '';
    this.document.head.appendChild(this.styleElement);

    effect((): void => {
      const margin: string = PRINT_MARGINS[this.settings.value('application.printMargin')()];
      this.styleElement.textContent = `@page { margin: ${margin}; }`;
    });
  }

  /**
   * Prints the active document through the browser print dialog, which applies the print stylesheet
   * and the `@page` margin.
   */
  public print(): void {
    this.document.defaultView?.print();
  }

  /**
   * Exports the active document to a PDF, prompting the user for a destination through the main
   * process. The rendered PDF applies the same print stylesheet and margin as {@link print}. Degrades
   * to a no-op reporting failure outside Electron, where no bridge is available.
   * @param documentName The active document's name (for example `notes.md`); its extension is swapped
   * for `.pdf` to seed the save dialog.
   * @returns Returns the outcome describing success, cancellation, or failure.
   */
  public async exportPdf(documentName: string): Promise<ExportPdfResult> {
    const request: ExportPdfRequest = { defaultFileName: this.toPdfFileName(documentName) };
    return (
      (await this.bridge?.invoke<ExportPdfResult>(PrintChannel.ExportPdf, request)) ?? {
        success: false,
        error: 'PDF export is only available in the desktop app',
      }
    );
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
