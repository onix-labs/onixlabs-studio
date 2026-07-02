import type * as MonacoApi from 'monaco-editor';
import { EditorLocation, Editors } from '@shared/angular/services/editors/editors';
import { LSP_MARKER_OWNER } from '../lsp/lsp-marker-owner';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Diagnostic, DiagnosticSeverity, DiagnosticsProvider } from './diagnostics';

/**
 * A no-op disconnect used when there is nothing to tear down.
 */
const NO_OP: () => void = (): void => {
  // Intentionally empty.
};

/**
 * Supplies diagnostics from Monaco's in-editor language services (the TypeScript/JavaScript/JSON/CSS
 * workers). It mirrors `monaco.editor.getModelMarkers` into the provider-agnostic {@link Diagnostic}
 * shape and re-emits whenever the markers change. This yields real diagnostics for Monaco's bundled
 * languages with no compiler integration. Monaco is only loaded inside Electron, so outside it (the
 * browser or unit tests) the provider connects as a no-op.
 */
export class MonacoDiagnosticsProvider implements DiagnosticsProvider {
  /**
   * Gets the unique identifier of this provider.
   */
  public readonly id: string = 'monaco';

  /**
   * Holds the Monaco service used to load and read the editor markers.
   */
  private readonly monaco: Monaco;

  /**
   * Holds the editor registry that resolves a marker's model URI back to its document.
   */
  private readonly editors: Editors;

  /**
   * Initializes a new instance of the {@link MonacoDiagnosticsProvider} class.
   * @param monaco The Monaco service.
   * @param editors The editor registry that resolves marker resources to documents.
   */
  public constructor(monaco: Monaco, editors: Editors) {
    this.monaco = monaco;
    this.editors = editors;
  }

  /**
   * Connects the provider: once Monaco is loaded, emits the current markers and subscribes to
   * subsequent changes.
   * @param onChange Receives the current diagnostics whenever the markers change.
   * @returns Returns a function that unsubscribes from marker changes.
   */
  public connect(onChange: (diagnostics: readonly Diagnostic[]) => void): () => void {
    if (window.studio === undefined) {
      return NO_OP;
    }
    let disposable: MonacoApi.IDisposable | null = null;
    void this.monaco.ensureLoaded().then((): void => {
      const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
      if (monaco === undefined) {
        return;
      }
      const emit: () => void = (): void => onChange(this.collect(monaco));
      emit();
      disposable = monaco.editor.onDidChangeMarkers((): void => emit());
    });
    return (): void => disposable?.dispose();
  }

  /**
   * Reads every model marker and maps it to a provider-agnostic diagnostic.
   * @param monaco The loaded Monaco namespace.
   * @returns Returns the current diagnostics.
   */
  private collect(monaco: typeof MonacoApi): readonly Diagnostic[] {
    return (
      monaco.editor
        .getModelMarkers({})
        // Language-server markers are surfaced by the LSP provider already; skip them here so they do
        // not appear in the Problems panel twice.
        .filter((marker: MonacoApi.editor.IMarker): boolean => marker.owner !== LSP_MARKER_OWNER)
        .map((marker: MonacoApi.editor.IMarker): Diagnostic => {
          const location: EditorLocation | undefined = this.editors.locate(
            marker.resource.toString(),
          );
          return {
            file: location?.name ?? this.basename(marker.resource.path),
            message: marker.message,
            severity: this.severityOf(monaco, marker.severity),
            line: marker.startLineNumber,
            column: marker.startColumn,
            source: marker.source ?? '',
            documentId: location?.documentId ?? null,
            path: location?.path ?? null,
          };
        })
    );
  }

  /**
   * Maps a Monaco marker severity to a provider-agnostic severity.
   * @param monaco The loaded Monaco namespace (for the severity enum).
   * @param severity The marker severity.
   * @returns Returns the mapped severity.
   */
  private severityOf(
    monaco: typeof MonacoApi,
    severity: MonacoApi.MarkerSeverity,
  ): DiagnosticSeverity {
    switch (severity) {
      case monaco.MarkerSeverity.Error:
        return 'error';
      case monaco.MarkerSeverity.Warning:
        return 'warning';
      case monaco.MarkerSeverity.Info:
        return 'info';
      default:
        return 'hint';
    }
  }

  /**
   * Extracts the base name from a marker resource path.
   * @param path The resource path.
   * @returns Returns the base name.
   */
  private basename(path: string): string {
    const segments: string[] = path.split('/');
    return segments[segments.length - 1];
  }
}
