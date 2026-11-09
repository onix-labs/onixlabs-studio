import {
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  SaveDialogReturnValue,
  shell,
  WebContentsPrintOptions,
} from 'electron';
import { showSaveDialog } from './dialog-parent';
import { logger } from './logger';
import * as fs from 'node:fs/promises';
import {
  ExportPdfRequest,
  ExportPdfResult,
  PrintChannel,
  PrintPage,
  PrintPageSize,
  PrintRequest,
  PrintResult,
} from '@shared/api/print-channels';

/**
 * Holds the paper sizes a request may name; anything else is printed on A4.
 */
const PAGE_SIZES: ReadonlySet<string> = new Set<PrintPageSize>(['A4', 'Letter', 'Legal', 'A3']);

/**
 * Holds the page used when a request names none or a malformed one: portrait A4, no backgrounds, no
 * header or footer.
 */
const DEFAULT_PAGE: PrintPage = { pageSize: 'A4', landscape: false, printBackground: false };

/**
 * Handles exporting the current document to a PDF on behalf of the renderer.
 *
 * The renderer asks for an export; this renders the requesting window's contents through Chromium's
 * print path (which applies the same print stylesheet and `@page` margins as {@link window.print}, so
 * the exported PDF matches the printed page), prompts for a destination, writes the bytes, and opens
 * the result in the operating system's default PDF viewer — which doubles as the print preview. It
 * also prints, so the page header and footer (file name, date, page numbers) can be asked for, which
 * `window.print()` cannot do.
 */
export class PrintManager {
  /**
   * Registers the print IPC handlers.
   */
  public register(): void {
    logger.trace('PrintManager', 'Registering print IPC handlers');
    ipcMain.handle(
      PrintChannel.ExportPdf,
      (event: IpcMainInvokeEvent, request: unknown): Promise<ExportPdfResult> => {
        logger.trace('PrintManager', 'ExportPdf requested');
        return this.exportPdf(event, request);
      },
    );
    ipcMain.handle(
      PrintChannel.Print,
      (event: IpcMainInvokeEvent, request: unknown): Promise<PrintResult> => {
        logger.trace('PrintManager', 'Print requested');
        return this.print(event, request);
      },
    );
  }

  /**
   * Prints the requesting window's current document through the system print dialog.
   * @param event The invocation event, whose sender is printed.
   * @param request The print request carrying the page.
   * @returns Returns the outcome once the job is sent or the dialog is dismissed.
   */
  private print(event: IpcMainInvokeEvent, request: unknown): Promise<PrintResult> {
    const page: PrintPage = this.resolvePage((request as Partial<PrintRequest> | null)?.page);
    // The paper and orientation are the `@page` rule's, which the system dialog takes as its
    // default; stating them again here would fight the user's choice in the dialog. Chromium draws
    // its header (date, then title) and footer (page number) only when a header is given.
    const options: WebContentsPrintOptions = {
      printBackground: page.printBackground,
      ...(page.headerTitle === undefined ? {} : { header: page.headerTitle }),
    };
    return this.onWhiteCanvas(
      BrowserWindow.fromWebContents(event.sender),
      page,
      (): Promise<PrintResult> =>
        new Promise<PrintResult>((resolve: (result: PrintResult) => void): void => {
          event.sender.print(options, (success: boolean, failureReason: string): void => {
            logger.debug('PrintManager', `Print finished: ${success ? 'sent' : failureReason}`);
            resolve(success ? { success: true } : { success: false, error: failureReason });
          });
        }),
    );
  }

  /**
   * Exports the requesting window's current document to a PDF file.
   * @param event The invocation event, used to resolve the requesting window.
   * @param request The export request carrying the suggested file name.
   * @returns Returns the outcome describing success, cancellation, or failure.
   */
  private async exportPdf(event: IpcMainInvokeEvent, request: unknown): Promise<ExportPdfResult> {
    const window: BrowserWindow | null = BrowserWindow.fromWebContents(event.sender);
    if (window === null) {
      logger.warn('PrintManager', 'PDF export requested but no window to export from');
      return { success: false, error: 'No window to export from' };
    }

    const defaultFileName: string = this.resolveFileName(request);
    const page: PrintPage = this.resolvePage((request as Partial<ExportPdfRequest> | null)?.page);
    const openAfterExport: boolean =
      (request as Partial<ExportPdfRequest> | null)?.openAfterExport !== false;

    // The requesting window supplies the CONTENT, but it is not necessarily the right sheet parent:
    // a document printed from a child window is requested by the renderer that owns it, which may be
    // off screen. See `resolveDialogParent`.
    const result: SaveDialogReturnValue = await showSaveDialog(event.sender, undefined, {
      defaultPath: defaultFileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
      logger.trace('PrintManager', 'PDF export cancelled at save dialog');
      return { success: false, canceled: true };
    }

    logger.debug('PrintManager', `Rendering PDF to ${result.filePath}`);
    try {
      // Zero margins on every edge remove the print system's own, leaving the CSS @page margin (driven
      // by the user's "Print margins" setting) as the sole source — so an export matches a print.
      //
      // Stated edge by edge because Electron 42.10 replaced `Margins` (which took `marginType: 'none'`)
      // with `PrintToPDFMargins`, which takes inches and nothing else. Note that OMITTING margins is
      // not the same thing: each edge then defaults to ~0.4 inches, which would sit on top of the CSS
      // margin and quietly indent every exported page against the printed one.
      //
      // The paper and orientation are the Printing settings'. Background printing is off unless asked
      // for (as a normal print's is by default).
      const data: Buffer = await this.onWhiteCanvas(window, page, (): Promise<Buffer> =>
        event.sender.printToPDF({
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          pageSize: page.pageSize,
          landscape: page.landscape,
          printBackground: page.printBackground,
          ...this.headerAndFooter(page),
        }),
      );
      await fs.writeFile(result.filePath, data);
      // Open the finished PDF in the default viewer; this is also the "preview" the print dialog lacks.
      if (openAfterExport) {
        void shell.openPath(result.filePath);
      }
      logger.info('PrintManager', `Exported PDF to ${result.filePath}`);
      return { success: true, path: result.filePath };
    } catch (error: unknown) {
      logger.error('PrintManager', 'PDF export failed', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Runs a print with the window's background white while backgrounds print. Chromium paints the
   * `@page` margin band in the window's own background colour — black, so a dark launch shows no
   * flash — which would frame every page in black even though the document itself is white.
   * @param window The window being printed, or null when it cannot be resolved.
   * @param page The page, whose background setting decides whether the colour matters.
   * @param run The print.
   * @returns Returns the print's result, once the window's colour is restored.
   */
  private async onWhiteCanvas<T>(
    window: BrowserWindow | null,
    page: PrintPage,
    run: () => Promise<T>,
  ): Promise<T> {
    if (window === null || !page.printBackground) {
      return run();
    }
    const original: string = window.getBackgroundColor();
    window.setBackgroundColor('#FFFFFF');
    try {
      return await run();
    } finally {
      window.setBackgroundColor(original);
    }
  }

  /**
   * Builds the PDF header and footer templates for a page: the file name and date at the top, the
   * page number at the bottom, drawn by Chromium in the `@page` margin. A page asking for none gets
   * none.
   * @param page The page.
   * @returns Returns the header and footer options to spread into the PDF options.
   */
  private headerAndFooter(page: PrintPage): {
    displayHeaderFooter: boolean;
    headerTemplate?: string;
    footerTemplate?: string;
  } {
    if (page.headerTitle === undefined) {
      return { displayHeaderFooter: false };
    }
    // Chromium sets the templates at a zero font size unless told otherwise, and fills the `date`,
    // `pageNumber` and `totalPages` classes itself. The title is the user's file name, so it is escaped.
    const style: string =
      'font: 8pt Helvetica, Arial, sans-serif; color: #555; width: 100%; ' +
      'margin: 0 1cm; display: flex; justify-content: space-between;';
    return {
      displayHeaderFooter: true,
      headerTemplate:
        `<div style='${style}'><span>${escapeHtml(page.headerTitle)}</span>` +
        `<span class='date'></span></div>`,
      footerTemplate:
        `<div style='${style} justify-content: center;'>` +
        `<span><span class='pageNumber'></span> / <span class='totalPages'></span></span></div>`,
    };
  }

  /**
   * Resolves the page a request names, falling back to {@link DEFAULT_PAGE} field by field when the
   * payload is absent or malformed.
   * @param candidate The request's page.
   * @returns Returns the page to print on.
   */
  private resolvePage(candidate: Partial<PrintPage> | undefined): PrintPage {
    const title: unknown = candidate?.headerTitle;
    return {
      pageSize:
        typeof candidate?.pageSize === 'string' && PAGE_SIZES.has(candidate.pageSize)
          ? candidate.pageSize
          : DEFAULT_PAGE.pageSize,
      landscape: candidate?.landscape === true,
      printBackground: candidate?.printBackground === true,
      headerTitle: typeof title === 'string' && title.length > 0 ? title : undefined,
    };
  }

  /**
   * Resolves the suggested save-dialog file name from the request, falling back to a generic name when
   * the payload is malformed.
   * @param request The export request.
   * @returns Returns the `.pdf` file name to suggest.
   */
  private resolveFileName(request: unknown): string {
    const candidate: unknown = (request as Partial<ExportPdfRequest> | null)?.defaultFileName;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'document.pdf';
  }
}

/**
 * Escapes the characters that would let text break out of an HTML template.
 * @param text The text.
 * @returns Returns the text with `&`, `<`, `>`, `"` and `'` escaped.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character: string): string => `&#${character.charCodeAt(0)};`);
}
