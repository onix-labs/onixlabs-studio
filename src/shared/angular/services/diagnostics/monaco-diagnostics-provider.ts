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
 * How long marker-change events are coalesced before the markers are collected and fanned out. A
 * language server streaming diagnostics across many documents fires the change event per document;
 * collecting once per burst instead of once per event keeps the cost flat.
 */
const MARKER_DEBOUNCE_MS: number = 100;

/**
 * The shared mirror of Monaco's global marker state: its subscribers, the last collection, and the
 * single underlying subscription's teardown handles.
 */
interface MarkerMirror {
  readonly subscribers: Set<(diagnostics: readonly Diagnostic[]) => void>;
  last: readonly Diagnostic[];
  disposable: MonacoApi.IDisposable | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The shared mirrors, keyed by the Monaco namespace whose markers they observe (one in production;
 * tests get one per fake). `onDidChangeMarkers` and `getModelMarkers({})` are global to a namespace —
 * but this provider is constructed once per workspace view (each has its own
 * {@link import('./diagnostics').Diagnostics} aggregate), and one collection per instance per change
 * meant every marker change cost N full collections. All instances share one subscription per
 * namespace instead; each workspace's aggregate still filters the shared collection down to its own
 * documents.
 */
const sharedMirrors: WeakMap<object, MarkerMirror> = new WeakMap<object, MarkerMirror>();

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
   * Connects the provider: once Monaco is loaded, joins the shared marker mirror (creating it and
   * its single global subscription on first use), receives its debounced collections, and emits the
   * current state immediately.
   * @param onChange Receives the current diagnostics whenever the markers change.
   * @returns Returns a function that unsubscribes from marker changes.
   */
  public connect(onChange: (diagnostics: readonly Diagnostic[]) => void): () => void {
    if (window.bridge === undefined) {
      return NO_OP;
    }
    let joined: { monaco: typeof MonacoApi; mirror: MarkerMirror } | null = null;
    void this.monaco.ensureLoaded().then((): void => {
      const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
      if (monaco === undefined) {
        return;
      }
      let mirror: MarkerMirror | undefined = sharedMirrors.get(monaco);
      if (mirror === undefined) {
        const created: MarkerMirror = {
          subscribers: new Set<(diagnostics: readonly Diagnostic[]) => void>(),
          last: this.collect(monaco),
          disposable: null,
          timer: null,
        };
        sharedMirrors.set(monaco, created);
        created.disposable = monaco.editor.onDidChangeMarkers((): void => {
          if (created.timer !== null) {
            return;
          }
          created.timer = setTimeout((): void => {
            created.timer = null;
            created.last = this.collect(monaco);
            for (const subscriber of created.subscribers) {
              subscriber(created.last);
            }
          }, MARKER_DEBOUNCE_MS);
        });
        mirror = created;
      }
      joined = { monaco, mirror };
      mirror.subscribers.add(onChange);
      onChange(mirror.last);
    });
    return (): void => {
      if (joined === null) {
        return;
      }
      joined.mirror.subscribers.delete(onChange);
      if (joined.mirror.subscribers.size === 0) {
        joined.mirror.disposable?.dispose();
        if (joined.mirror.timer !== null) {
          clearTimeout(joined.mirror.timer);
        }
        sharedMirrors.delete(joined.monaco);
      }
      joined = null;
    };
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
