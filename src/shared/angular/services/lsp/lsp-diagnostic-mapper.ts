import type * as MonacoApi from 'monaco-editor';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostics';
import type { LspDiagnostic } from './lsp-client';
import { basename, uriToPath } from './lsp-paths';

/**
 * Identifies the document a language-server diagnostic is mapped against: the pair of values the
 * provider-agnostic {@link Diagnostic} needs that are not carried on the protocol diagnostic itself.
 */
export interface DiagnosticContext {
  /**
   * Gets the document's `file:` URI.
   */
  readonly uri: string;

  /**
   * Gets the document identifier.
   */
  readonly documentId: string;
}

/**
 * Maps a Language Server Protocol severity to the provider-agnostic severity.
 * @param severity The protocol severity (1 error, 2 warning, 3 information), or undefined.
 * @returns Returns the mapped severity.
 */
export function severityOf(severity: number | undefined): DiagnosticSeverity {
  switch (severity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 3:
      return 'info';
    default:
      return 'hint';
  }
}

/**
 * Maps a Language Server Protocol severity to a Monaco marker severity.
 * @param monaco The loaded Monaco namespace (for the severity enum).
 * @param severity The protocol severity, or undefined.
 * @returns Returns the Monaco marker severity.
 */
export function markerSeverityOf(
  monaco: typeof MonacoApi,
  severity: number | undefined,
): MonacoApi.MarkerSeverity {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    default:
      return monaco.MarkerSeverity.Hint;
  }
}

/**
 * Maps a language-server diagnostic into the provider-agnostic shape for the given document.
 * @param diagnostic The server diagnostic.
 * @param context The document the diagnostic belongs to.
 * @returns Returns the mapped diagnostic.
 */
export function toDiagnostic(diagnostic: LspDiagnostic, context: DiagnosticContext): Diagnostic {
  const path: string = uriToPath(context.uri);
  return {
    file: basename(path),
    message: diagnostic.message,
    severity: severityOf(diagnostic.severity),
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    source: diagnostic.source ?? '',
    documentId: context.documentId,
    path,
  };
}

/**
 * Maps server diagnostics into Monaco marker data (converting the protocol's zero-based positions to
 * Monaco's one-based line and column numbers).
 * @param monaco The loaded Monaco namespace.
 * @param diagnostics The server diagnostics.
 * @returns Returns the Monaco marker data.
 */
export function toMarkerData(
  monaco: typeof MonacoApi,
  diagnostics: readonly LspDiagnostic[],
): MonacoApi.editor.IMarkerData[] {
  return diagnostics.map(
    (diagnostic: LspDiagnostic): MonacoApi.editor.IMarkerData => ({
      severity: markerSeverityOf(monaco, diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source,
      startLineNumber: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLineNumber: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
    }),
  );
}
