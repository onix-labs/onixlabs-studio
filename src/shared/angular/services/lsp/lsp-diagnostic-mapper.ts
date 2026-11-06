import type * as MonacoApi from 'monaco-editor';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostics';
import type { LspDiagnostic } from './lsp-client';
import { basename, uriToPath } from './lsp-paths';

/**
 * The protocol's tag on code a diagnostic marks as unnecessary, such as an unused variable.
 */
const UNNECESSARY_TAG: number = 1;

/**
 * The protocol's tag on code a diagnostic marks as deprecated.
 */
const DEPRECATED_TAG: number = 2;

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
   * Gets the document identifier, or null for a file that is not open (a workspace diagnostic,
   * #1144), which is located by its path alone.
   */
  readonly documentId: string | null;
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
 * Maps a diagnostic's protocol tags to Monaco's, which fade unnecessary code and strike deprecated
 * code through. A tag this build does not know is left out rather than guessed at.
 * @param monaco The loaded Monaco namespace (for the tag enum).
 * @param tags The protocol tags, or undefined.
 * @returns Returns the Monaco marker tags.
 */
export function markerTagsOf(
  monaco: typeof MonacoApi,
  tags: readonly number[] | undefined,
): MonacoApi.MarkerTag[] {
  const mapped: MonacoApi.MarkerTag[] = [];
  if (tags?.includes(UNNECESSARY_TAG) === true) {
    mapped.push(monaco.MarkerTag.Unnecessary);
  }
  if (tags?.includes(DEPRECATED_TAG) === true) {
    mapped.push(monaco.MarkerTag.Deprecated);
  }
  return mapped;
}

/**
 * Decides whether a diagnostic belongs in the Error List. A hint carrying a tag is an editor treatment
 * (fading an unused name, striking a deprecated one through) rather than a problem to work through, so
 * it stays in the editor. A tagged warning or error is a problem the server or the project asked for,
 * and stays listed.
 * @param diagnostic The server diagnostic.
 * @returns Returns true when the diagnostic is listed, false when it only marks the editor.
 */
export function isErrorListDiagnostic(diagnostic: LspDiagnostic): boolean {
  const tagged: boolean =
    diagnostic.tags?.includes(UNNECESSARY_TAG) === true ||
    diagnostic.tags?.includes(DEPRECATED_TAG) === true;
  return !tagged || severityOf(diagnostic.severity) !== 'hint';
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
 * Monaco's one-based line and column numbers). A diagnostic's code rides along, so the marker shows it
 * (#1016), and so do its tags, which fade or strike the code; its server data stays with the client,
 * which sends it back with a code-action request.
 * @param monaco The loaded Monaco namespace.
 * @param diagnostics The server diagnostics.
 * @returns Returns the Monaco marker data.
 */
export function toMarkerData(
  monaco: typeof MonacoApi,
  diagnostics: readonly LspDiagnostic[],
): MonacoApi.editor.IMarkerData[] {
  return diagnostics.map((diagnostic: LspDiagnostic): MonacoApi.editor.IMarkerData => {
    const tags: MonacoApi.MarkerTag[] = markerTagsOf(monaco, diagnostic.tags);
    const marker: MonacoApi.editor.IMarkerData = {
      ...(tags.length > 0 ? { tags } : {}),
      severity: markerSeverityOf(monaco, diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source,
      startLineNumber: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLineNumber: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
    };
    return diagnostic.code === undefined ? marker : { ...marker, code: String(diagnostic.code) };
  });
}
