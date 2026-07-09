/**
 * Names the print/export IPC channels and the types their payloads carry. This is the print
 * capability's slice of the IPC contract: the shared printing client and the main-process print
 * manager name their channels from here, over the generic {@link import('./bridge').Bridge} transport.
 * Printing is shared plumbing (both the code and markdown editors export through it), so it lives in
 * `shared/api`.
 */
export enum PrintChannel {
  /**
   * Renders the current document to a PDF, prompts for a destination, and writes it there
   * (renderer→main, invoke).
   */
  ExportPdf = 'print:export-pdf',
}

/**
 * Describes a request to export the current document to a PDF file.
 */
export interface ExportPdfRequest {
  /**
   * Gets the file name suggested in the save dialog, including the `.pdf` extension (for example
   * `notes.pdf`).
   */
  readonly defaultFileName: string;
}

/**
 * Describes the outcome of a PDF export.
 */
export interface ExportPdfResult {
  /**
   * Gets a value indicating whether the export succeeded and the file was written.
   */
  readonly success: boolean;

  /**
   * Gets the absolute path the PDF was written to, when successful.
   */
  readonly path?: string;

  /**
   * Gets a value indicating whether the user cancelled the save dialog. When true, the export was not
   * an error and nothing was written.
   */
  readonly canceled?: boolean;

  /**
   * Gets the error message, when the export failed.
   */
  readonly error?: string;
}
