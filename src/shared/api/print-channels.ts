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

  /**
   * Prints the current document through the system print dialog, with the page header and footer
   * the request asks for (renderer→main, invoke).
   */
  Print = 'print:print',
}

/**
 * Names a paper size the print path understands, as Chromium names it.
 */
export type PrintPageSize = 'A4' | 'Letter' | 'Legal' | 'A3';

/**
 * Describes the page a document is printed or exported on.
 */
export interface PrintPage {
  /**
   * Gets the paper size.
   */
  readonly pageSize: PrintPageSize;

  /**
   * Gets a value indicating whether the page is laid out landscape rather than portrait.
   */
  readonly landscape: boolean;

  /**
   * Gets a value indicating whether background colours and shading are printed.
   */
  readonly printBackground: boolean;

  /**
   * Gets the document name printed in the page header, or undefined to print no header and footer.
   */
  readonly headerTitle?: string;
}

/**
 * Describes a request to print the current document through the system print dialog.
 */
export interface PrintRequest {
  /**
   * Gets the page the document is printed on.
   */
  readonly page: PrintPage;
}

/**
 * Describes the outcome of a print.
 */
export interface PrintResult {
  /**
   * Gets a value indicating whether the document was sent to the printer.
   */
  readonly success: boolean;

  /**
   * Gets the reason the print did not happen, when it did not; `cancelled` when the user dismissed
   * the print dialog.
   */
  readonly error?: string;
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

  /**
   * Gets the page the document is exported on. Absent, the export is portrait A4 with no
   * backgrounds, header or footer.
   */
  readonly page?: PrintPage;

  /**
   * Gets a value indicating whether the finished PDF is opened in the default PDF viewer. Absent, it
   * is.
   */
  readonly openAfterExport?: boolean;
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
