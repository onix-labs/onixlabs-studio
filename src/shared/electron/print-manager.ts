import { BrowserWindow, ipcMain, IpcMainInvokeEvent, SaveDialogReturnValue, shell } from 'electron';
import { showSaveDialog } from './dialog-parent';
import { logger } from './logger';
import * as fs from 'node:fs/promises';
import { ExportPdfRequest, ExportPdfResult, PrintChannel } from '@shared/api/print-channels';

/**
 * Handles exporting the current document to a PDF on behalf of the renderer.
 *
 * The renderer asks for an export; this renders the requesting window's contents through Chromium's
 * print path (which applies the same print stylesheet and `@page` margins as {@link window.print}, so
 * the exported PDF matches the printed page), prompts for a destination, writes the bytes, and opens
 * the result in the operating system's default PDF viewer — which doubles as the print preview.
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
      // marginType 'none' removes the print system's own margins, leaving the CSS @page margin (driven
      // by the user's "Print margins" setting) as the sole source — so an export matches a print.
      // Export produces a fixed-size A4 document rather than following the OS print dialog's paper.
      // printBackground stays off (as a normal print does by default): with it on, the dark-theme page
      // canvas paints over the @page margin band and frames the document in black.
      const data: Buffer = await event.sender.printToPDF({
        margins: { marginType: 'none' },
        pageSize: 'A4',
        printBackground: false,
      });
      await fs.writeFile(result.filePath, data);
      // Open the finished PDF in the default viewer; this is also the "preview" the print dialog lacks.
      void shell.openPath(result.filePath);
      logger.info('PrintManager', `Exported PDF to ${result.filePath}`);
      return { success: true, path: result.filePath };
    } catch (error: unknown) {
      logger.error('PrintManager', 'PDF export failed', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
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
