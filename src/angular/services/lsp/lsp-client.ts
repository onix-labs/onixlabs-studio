import { inject, OnDestroy, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { LspApi, LspExit, LspMessage, LspStartResult } from '../../../shared/lsp-types';
import { DirectoryListing } from '../../../shared/studio-api';
import { Diagnostic, Diagnostics, DiagnosticSeverity } from '../diagnostics/diagnostics';
import { Editors } from '../editors/editors';
import { Monaco } from '../monaco/monaco';
import { Workspace } from '../workspace/workspace';
import { LspDocumentRef, LspFeatures } from './lsp-features';
import { LSP_MARKER_OWNER } from './lsp-marker-owner';
import { LspSettings } from './lsp-settings';
import { LspStatus } from './lsp-status';

/**
 * Describes the state of an open document the client keeps a server in sync with.
 */
export interface LspDocumentState {
  /**
   * Gets the identifier of the document (its owning tab or well-document id).
   */
  readonly documentId: string;

  /**
   * Gets the document's absolute file path, or null when it has never been saved.
   */
  readonly path: string | null;

  /**
   * Gets the document's Monaco language identifier.
   */
  readonly languageId: string;

  /**
   * Gets the document's current text.
   */
  readonly content: string;
}

/**
 * A zero-based source position, as reported by the Language Server Protocol.
 */
interface LspPosition {
  /**
   * Gets the zero-based line.
   */
  readonly line: number;

  /**
   * Gets the zero-based character offset.
   */
  readonly character: number;
}

/**
 * A source range reported by the Language Server Protocol.
 */
interface LspRange {
  /**
   * Gets the start position.
   */
  readonly start: LspPosition;

  /**
   * Gets the end position.
   */
  readonly end: LspPosition;
}

/**
 * A single diagnostic reported by a language server.
 */
interface LspDiagnostic {
  /**
   * Gets the range the diagnostic applies to.
   */
  readonly range: LspRange;

  /**
   * Gets the severity (1 error, 2 warning, 3 information, 4 hint), or undefined.
   */
  readonly severity?: number;

  /**
   * Gets the human-readable message.
   */
  readonly message: string;

  /**
   * Gets the producing source (for example `typescript`), or undefined.
   */
  readonly source?: string;
}

/**
 * The parameters of a `textDocument/publishDiagnostics` notification.
 */
interface PublishDiagnosticsParams {
  /**
   * Gets the document URI the diagnostics are reported against.
   */
  readonly uri: string;

  /**
   * Gets the full current set of diagnostics for the document.
   */
  readonly diagnostics: readonly LspDiagnostic[];
}

/**
 * Tracks one document the client keeps synchronised with a server.
 */
interface TrackedDocument {
  /**
   * Holds the document identifier.
   */
  readonly documentId: string;

  /**
   * Holds the document's `file:` URI.
   */
  readonly uri: string;

  /**
   * Holds the identifier of the server the document is opened against.
   */
  readonly serverId: string;

  /**
   * Holds the document's Monaco language identifier.
   */
  languageId: string;

  /**
   * Holds the next document version number sent to the server.
   */
  version: number;

  /**
   * Holds whether `textDocument/didOpen` has been sent for the document.
   */
  opened: boolean;

  /**
   * Holds the tail of the per-document operation queue, serialising open/change/close so they reach
   * the server in order even though each awaits the session becoming ready.
   */
  queue: Promise<void>;
}

/**
 * Maps a Monaco language identifier to the registered server that handles it. A language without an
 * entry has no language server and is left to Monaco's built-in diagnostics.
 */
const LANGUAGE_SERVERS: Readonly<Record<string, string>> = {
  typescript: 'typescript',
  javascript: 'typescript',
  java: 'java',
};

/**
 * Identifies this provider's contribution within the {@link Diagnostics} aggregate.
 */
const PROVIDER_ID: string = 'lsp';

/**
 * Drives language-server document synchronisation and diagnostics for one workspace. It lazily starts
 * a server (rooted at the workspace) the first time a document of a supported language opens, mirrors
 * each open document's text to that server, and feeds the server's `publishDiagnostics` into the
 * workspace {@link Diagnostics} aggregate as an additional provider alongside Monaco's markers.
 *
 * The client is provided per workspace (each directory tab), so its sessions and diagnostics are
 * isolated. The root instance has no open folder and degrades to a no-op, as does any instance running
 * outside Electron where the language-server bridge is absent.
 */
@Service()
export class LspClient implements OnDestroy {
  /**
   * Holds the workspace whose root the servers are rooted at.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the workspace diagnostics aggregate this client contributes to.
   */
  private readonly diagnostics: Diagnostics = inject(Diagnostics);

  /**
   * Holds the Monaco service used to set diagnostics as editor markers.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the editor registry used to resolve a document's path to its Monaco model.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the status registry that surfaces server lifecycle state in the status strip.
   */
  private readonly status: LspStatus = inject(LspStatus);

  /**
   * Holds the editor-features registry this client resolves its documents for.
   */
  private readonly features: LspFeatures = inject(LspFeatures);

  /**
   * Holds the user's language-server settings, used to skip a server the user has disabled.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Holds the disposer that withdraws this client's document resolver, or null when not registered.
   */
  private featuresDisposer: (() => void) | null = null;

  /**
   * Holds the language-server bridge, or undefined when running outside Electron.
   */
  private readonly api: LspApi | undefined = window.studio?.lsp;

  /**
   * Holds the tracked documents, keyed by their normalised file path.
   */
  private readonly tracked: Map<string, TrackedDocument> = new Map<string, TrackedDocument>();

  /**
   * Holds the in-flight or settled start promise for each server, keyed by session id, so a server is
   * started at most once.
   */
  private readonly sessions: Map<string, Promise<boolean>> = new Map<string, Promise<boolean>>();

  /**
   * Holds the current diagnostics for each document, keyed by document id.
   */
  private readonly diagnosticsByDocument: Map<string, readonly Diagnostic[]> = new Map<
    string,
    readonly Diagnostic[]
  >();

  /**
   * Holds the languages whose built-in Monaco diagnostics have been suppressed, so each is suppressed
   * only once.
   */
  private readonly suppressed: Set<string> = new Set<string>();

  /**
   * Holds the callback that pushes the merged diagnostics into the aggregate, or null before the
   * provider connects.
   */
  private emit: ((diagnostics: readonly Diagnostic[]) => void) | null = null;

  /**
   * Holds the disposer for the diagnostics notification subscription, or null when not subscribed.
   */
  private notificationDisposer: (() => void) | null = null;

  /**
   * Holds the disposer for the server-exit subscription, or null when not subscribed.
   */
  private exitDisposer: (() => void) | null = null;

  /**
   * Initializes a new instance of the {@link LspClient} class, registering its diagnostics provider
   * and subscribing to server notifications when the bridge is available.
   */
  public constructor() {
    if (this.api === undefined) {
      return;
    }
    this.diagnostics.register({
      id: PROVIDER_ID,
      connect: (onChange: (diagnostics: readonly Diagnostic[]) => void): (() => void) => {
        this.emit = onChange;
        return (): void => {
          this.emit = null;
        };
      },
    });
    this.notificationDisposer = this.api.onNotification((message: LspMessage): void =>
      this.onNotification(message),
    );
    this.exitDisposer = this.api.onExit((exit: LspExit): void => this.onExit(exit));
    this.featuresDisposer = this.features.registerDocuments((path: string): LspDocumentRef | null =>
      this.resolveDocument(path),
    );
  }

  /**
   * Resolves a file path to the open document a feature request targets, for this workspace's editor
   * features. Returns null for paths this client does not own or has not opened against a server.
   * @param path The absolute file path to resolve.
   * @returns Returns the document reference, or null.
   */
  private resolveDocument(path: string): LspDocumentRef | null {
    const root: string | null = this.rootPath();
    if (root === null) {
      return null;
    }
    const tracked: TrackedDocument | undefined = this.tracked.get(this.normalise(path));
    if (!tracked?.opened) {
      return null;
    }
    return { sessionId: `${root}::${tracked.serverId}`, uri: tracked.uri };
  }

  /**
   * Synchronises a document's latest state with its language server: opens it on first sight, and
   * sends the new text on subsequent changes. Documents without a saved path, without a supporting
   * server, or outside the workspace root are ignored.
   * @param state The document's current state.
   */
  public syncDocument(state: LspDocumentState): void {
    const root: string | null = this.rootPath();
    if (this.api === undefined || root === null || state.path === null) {
      return;
    }
    const serverId: string | undefined = LANGUAGE_SERVERS[state.languageId];
    if (
      serverId === undefined ||
      this.lspSettings.isDisabled(serverId) ||
      !this.isWithin(state.path, root)
    ) {
      return;
    }
    const key: string = this.normalise(state.path);
    const existing: TrackedDocument | undefined = this.tracked.get(key);
    if (existing === undefined) {
      const tracked: TrackedDocument = {
        documentId: state.documentId,
        uri: this.pathToUri(state.path),
        serverId,
        languageId: state.languageId,
        version: 1,
        opened: false,
        queue: Promise.resolve(),
      };
      this.tracked.set(key, tracked);
      this.enqueue(tracked, (): Promise<void> => this.open(tracked, state.content));
    } else {
      existing.languageId = state.languageId;
      this.enqueue(existing, (): Promise<void> => this.change(existing, state.content));
    }
  }

  /**
   * Closes a document, sending `textDocument/didClose` and dropping its diagnostics.
   * @param documentId The identifier of the document to close.
   */
  public closeDocument(documentId: string): void {
    for (const [key, tracked] of this.tracked) {
      if (tracked.documentId !== documentId) {
        continue;
      }
      this.tracked.delete(key);
      this.diagnosticsByDocument.delete(documentId);
      this.setMarkers(tracked, []);
      this.publish();
      this.enqueue(tracked, (): Promise<void> => this.close(tracked));
      return;
    }
  }

  /**
   * Tears the client down: stops every server and unsubscribes from notifications. Called when the
   * workspace closes.
   */
  public ngOnDestroy(): void {
    this.notificationDisposer?.();
    this.exitDisposer?.();
    this.featuresDisposer?.();
    for (const sessionId of this.sessions.keys()) {
      void this.api?.stop(sessionId);
      this.status.remove(sessionId);
    }
    this.sessions.clear();
    this.tracked.clear();
  }

  /**
   * Appends an operation to a document's queue so open/change/close reach the server in order.
   * @param tracked The tracked document whose queue the operation joins.
   * @param operation The operation to run after the previous one settles.
   */
  private enqueue(tracked: TrackedDocument, operation: () => Promise<void>): void {
    tracked.queue = tracked.queue.then(operation, operation);
  }

  /**
   * Opens a document against its server, starting the server first if necessary.
   * @param tracked The document to open.
   * @param content The document's current text.
   * @returns Returns a promise that resolves once the open notification has been sent.
   */
  private async open(tracked: TrackedDocument, content: string): Promise<void> {
    const sessionId: string | null = await this.ensureSession(tracked.serverId);
    if (sessionId === null || this.api === undefined) {
      return;
    }
    // The server is now the authority for this language: turn off Monaco's built-in worker
    // diagnostics so its (project-blind) errors no longer compete with the server's. Done only on a
    // successful start, so a server that fails to launch leaves Monaco's diagnostics as a fallback.
    this.suppressBuiltInDiagnostics(tracked.languageId);
    tracked.opened = true;
    this.api.notify(sessionId, 'textDocument/didOpen', {
      textDocument: {
        uri: tracked.uri,
        languageId: tracked.languageId,
        version: tracked.version,
        text: content,
      },
    });
  }

  /**
   * Sends the latest text for an open document, opening it first when it has not been opened yet.
   * @param tracked The document to update.
   * @param content The document's current text.
   * @returns Returns a promise that resolves once the change notification has been sent.
   */
  private async change(tracked: TrackedDocument, content: string): Promise<void> {
    if (!tracked.opened) {
      await this.open(tracked, content);
      return;
    }
    const sessionId: string | null = await this.ensureSession(tracked.serverId);
    if (sessionId === null || this.api === undefined) {
      return;
    }
    tracked.version += 1;
    this.api.notify(sessionId, 'textDocument/didChange', {
      textDocument: { uri: tracked.uri, version: tracked.version },
      contentChanges: [{ text: content }],
    });
  }

  /**
   * Sends `textDocument/didClose` for a document that has been opened.
   * @param tracked The document to close.
   * @returns Returns a promise that resolves once the close notification has been sent.
   */
  private async close(tracked: TrackedDocument): Promise<void> {
    if (!tracked.opened || this.api === undefined) {
      return;
    }
    const sessionId: string | null = await this.ensureSession(tracked.serverId);
    if (sessionId === null) {
      return;
    }
    this.api.notify(sessionId, 'textDocument/didClose', {
      textDocument: { uri: tracked.uri },
    });
  }

  /**
   * Ensures the server for a given id is started for this workspace, starting it at most once.
   * @param serverId The identifier of the server to start.
   * @returns Returns the session id when the server is running, or null when it failed to start or the
   * workspace has since closed.
   */
  private async ensureSession(serverId: string): Promise<string | null> {
    const root: string | null = this.rootPath();
    if (this.api === undefined || root === null) {
      return null;
    }
    const sessionId: string = `${root}::${serverId}`;
    let pending: Promise<boolean> | undefined = this.sessions.get(sessionId);
    if (pending === undefined) {
      this.status.report(sessionId, serverId, 'starting');
      pending = this.api
        .start({ sessionId, serverId, rootPath: root })
        .then((result: LspStartResult): boolean => {
          this.status.report(
            sessionId,
            serverId,
            result.success ? 'ready' : 'unavailable',
            result.error,
          );
          return result.success;
        });
      this.sessions.set(sessionId, pending);
    }
    const started: boolean = await pending;
    return started ? sessionId : null;
  }

  /**
   * Handles a server notification, mapping `publishDiagnostics` for one of this client's sessions into
   * the workspace diagnostics aggregate.
   * @param message The notification from a server.
   */
  private onNotification(message: LspMessage): void {
    if (
      message.method !== 'textDocument/publishDiagnostics' ||
      !this.ownsSession(message.sessionId)
    ) {
      return;
    }
    const params: PublishDiagnosticsParams = message.params as PublishDiagnosticsParams;
    const key: string = this.normalise(this.uriToPath(params.uri));
    const tracked: TrackedDocument | undefined = this.tracked.get(key);
    if (tracked === undefined) {
      return;
    }
    this.diagnosticsByDocument.set(
      tracked.documentId,
      params.diagnostics.map(
        (diagnostic: LspDiagnostic): Diagnostic => this.toDiagnostic(diagnostic, tracked),
      ),
    );
    this.setMarkers(tracked, params.diagnostics);
    this.publish();
  }

  /**
   * Disables Monaco's built-in diagnostics for a language the first time a server for it starts, so
   * the server is the sole source of that language's diagnostics.
   * @param languageId The Monaco language identifier to suppress built-in diagnostics for.
   */
  private suppressBuiltInDiagnostics(languageId: string): void {
    if (this.suppressed.has(languageId)) {
      return;
    }
    this.suppressed.add(languageId);
    this.monaco.suppressBuiltInDiagnostics(languageId);
  }

  /**
   * Sets the language-server diagnostics as Monaco markers on the document's model, so they render in
   * the editor. Does nothing when Monaco is unavailable or the document has no live editor model.
   * @param tracked The document the diagnostics belong to.
   * @param diagnostics The server diagnostics to set (an empty array clears them).
   */
  private setMarkers(tracked: TrackedDocument, diagnostics: readonly LspDiagnostic[]): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return;
    }
    const modelUri: string | undefined = this.editors.modelUriForPath(this.uriToPath(tracked.uri));
    if (modelUri === undefined) {
      return;
    }
    const model: MonacoApi.editor.ITextModel | null = monaco.editor.getModel(
      monaco.Uri.parse(modelUri),
    );
    if (model === null) {
      return;
    }
    const markers: MonacoApi.editor.IMarkerData[] = diagnostics.map(
      (diagnostic: LspDiagnostic): MonacoApi.editor.IMarkerData => ({
        severity: this.markerSeverityOf(monaco, diagnostic.severity),
        message: diagnostic.message,
        source: diagnostic.source,
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
      }),
    );
    monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, markers);
  }

  /**
   * Maps a Language Server Protocol severity to a Monaco marker severity.
   * @param monaco The loaded Monaco namespace (for the severity enum).
   * @param severity The protocol severity, or undefined.
   * @returns Returns the Monaco marker severity.
   */
  private markerSeverityOf(
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
   * Handles a server process exiting: forgets the session so it is restarted on the next document
   * sync, and marks its documents unopened so they are re-sent.
   * @param exit The exit report.
   */
  private onExit(exit: LspExit): void {
    if (!this.sessions.delete(exit.sessionId)) {
      return;
    }
    this.status.remove(exit.sessionId);
    for (const tracked of this.tracked.values()) {
      if (`${this.rootPath() ?? ''}::${tracked.serverId}` === exit.sessionId) {
        tracked.opened = false;
      }
    }
  }

  /**
   * Determines whether a session id belongs to this workspace's client.
   * @param sessionId The session id to test.
   * @returns Returns true when this client started the session.
   */
  private ownsSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Maps a language-server diagnostic into the provider-agnostic shape, resolving its document.
   * @param diagnostic The server diagnostic.
   * @param tracked The document the diagnostic belongs to.
   * @returns Returns the mapped diagnostic.
   */
  private toDiagnostic(diagnostic: LspDiagnostic, tracked: TrackedDocument): Diagnostic {
    const path: string = this.uriToPath(tracked.uri);
    return {
      file: this.basename(path),
      message: diagnostic.message,
      severity: this.severityOf(diagnostic.severity),
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      source: diagnostic.source ?? '',
      documentId: tracked.documentId,
      path,
    };
  }

  /**
   * Pushes the merged diagnostics across every tracked document into the aggregate.
   */
  private publish(): void {
    if (this.emit === null) {
      return;
    }
    const merged: Diagnostic[] = [];
    for (const diagnostics of this.diagnosticsByDocument.values()) {
      merged.push(...diagnostics);
    }
    this.emit(merged);
  }

  /**
   * Maps a Language Server Protocol severity to the provider-agnostic severity.
   * @param severity The protocol severity, or undefined.
   * @returns Returns the mapped severity.
   */
  private severityOf(severity: number | undefined): DiagnosticSeverity {
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
   * Gets the workspace's open root path, or null when no folder is open.
   * @returns Returns the absolute root path, or null.
   */
  private rootPath(): string | null {
    const listing: DirectoryListing | null = this.workspace.root();
    return listing?.path ?? null;
  }

  /**
   * Determines whether a path lies within a root (the root itself or a descendant).
   * @param target The path to test.
   * @param root The workspace root.
   * @returns Returns true when the path is within the root.
   */
  private isWithin(target: string, root: string): boolean {
    const normalisedTarget: string = this.normalise(target);
    const normalisedRoot: string = this.normalise(root);
    return normalisedTarget === normalisedRoot || normalisedTarget.startsWith(`${normalisedRoot}/`);
  }

  /**
   * Normalises a path for use as a map key and prefix comparison: back-slashes become forward
   * slashes and the drive letter is lower-cased, so the same file always maps to one key.
   * @param path The path to normalise.
   * @returns Returns the normalised path.
   */
  private normalise(path: string): string {
    const slashed: string = path.replace(/\\/g, '/');
    return /^[a-zA-Z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
  }

  /**
   * Converts an absolute file path to a `file:` URI.
   * @param path The absolute path.
   * @returns Returns the file URI.
   */
  private pathToUri(path: string): string {
    const slashed: string = path.replace(/\\/g, '/');
    const absolute: string = slashed.startsWith('/') ? slashed : `/${slashed}`;
    return encodeURI(`file://${absolute}`);
  }

  /**
   * Converts a `file:` URI back to an absolute path.
   * @param uri The file URI.
   * @returns Returns the absolute path.
   */
  private uriToPath(uri: string): string {
    const withoutScheme: string = decodeURI(uri).replace(/^file:\/\//, '');
    return /^\/[a-zA-Z]:/.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
  }

  /**
   * Extracts the base name from a path.
   * @param path The path to extract from.
   * @returns Returns the final path segment.
   */
  private basename(path: string): string {
    const segments: string[] = path.split('/');
    return segments[segments.length - 1];
  }
}
