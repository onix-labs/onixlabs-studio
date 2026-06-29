import { inject, OnDestroy, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  LspApi,
  LspExit,
  LspMessage,
  LspSemanticTokensLegend,
  LspStartResult,
} from '../../../shared/lsp-types';
import { DirectoryListing } from '../../../shared/studio-api';
import { Diagnostic, Diagnostics, DiagnosticSeverity } from '../diagnostics/diagnostics';
import { Editors } from '../editors/editors';
import { Monaco } from '../monaco/monaco';
import { Workspace } from '@shared/angular/services/workspace/workspace';
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
   * Holds the root the document's server session is rooted at: the workspace root for a document
   * inside the open folder, or the document's own parent directory for a standalone file.
   */
  readonly rootPath: string;

  /**
   * Holds whether the document is a standalone file (rooted at its own directory, with no open
   * workspace), so its session start can vouch for that directory to the main process.
   */
  readonly standalone: boolean;

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
   * Holds the text last synchronised to the server. A change is sent as a single edit replacing this
   * (the whole previous document) with the new text, so the notification carries the range that
   * servers advertising incremental sync (such as Roslyn) require — a range-less full-text change
   * crashes them. Empty until the document has been opened.
   */
  text: string;

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
  python: 'python',
  csharp: 'csharp',
  cpp: 'clangd',
  c: 'clangd',
};

/**
 * Identifies this provider's contribution within the {@link Diagnostics} aggregate.
 */
const PROVIDER_ID: string = 'lsp';

/**
 * Drives language-server document synchronisation and diagnostics. It lazily starts a server the
 * first time a document of a supported language opens, mirrors each open document's text to that
 * server, and feeds the server's `publishDiagnostics` into the {@link Diagnostics} aggregate as an
 * additional provider alongside Monaco's markers.
 *
 * The client is provided per workspace (each directory tab), where its documents are rooted at the
 * open folder. The root instance (a standalone code tab opened without a folder) instead roots each
 * document's server at the file's own parent directory, so a single opened file still gets diagnostics
 * and editor features (surfaced as editor markers, since a standalone tab has no Problems panel).
 * Outside Electron the language-server bridge is absent and the client is a no-op.
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
   * Holds the parameters each session was started with, keyed by session id, so a restart can bring a
   * server back up even when it currently serves no open documents.
   */
  private readonly sessionInfo: Map<
    string,
    { serverId: string; rootPath: string; standaloneFile?: string }
  > = new Map<string, { serverId: string; rootPath: string; standaloneFile?: string }>();

  /**
   * Holds each started session's semantic token legend (the server's own ordered token-type and
   * modifier names), or null when the server does not provide semantic tokens.
   */
  private readonly legends: Map<string, LspSemanticTokensLegend | null> = new Map<
    string,
    LspSemanticTokensLegend | null
  >();

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
    const tracked: TrackedDocument | undefined = this.tracked.get(this.normalise(path));
    if (!tracked?.opened) {
      return null;
    }
    const sessionId: string = `${tracked.rootPath}::${tracked.serverId}`;
    return { sessionId, uri: tracked.uri, semanticLegend: this.legends.get(sessionId) ?? null };
  }

  /**
   * Extracts the semantic token legend from a server's initialize capabilities, or null when the
   * server does not advertise a semantic tokens provider with a legend.
   * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
   * @returns Returns the legend, or null.
   */
  private semanticLegendOf(capabilities: unknown): LspSemanticTokensLegend | null {
    const provider: unknown = (capabilities as { semanticTokensProvider?: unknown } | undefined)
      ?.semanticTokensProvider;
    const legend: unknown = (provider as { legend?: unknown } | undefined)?.legend;
    const candidate: { tokenTypes?: unknown; tokenModifiers?: unknown } | undefined = legend as
      | { tokenTypes?: unknown; tokenModifiers?: unknown }
      | undefined;
    if (
      candidate === undefined ||
      !Array.isArray(candidate.tokenTypes) ||
      !Array.isArray(candidate.tokenModifiers)
    ) {
      return null;
    }
    return {
      tokenTypes: candidate.tokenTypes as readonly string[],
      tokenModifiers: candidate.tokenModifiers as readonly string[],
    };
  }

  /**
   * Synchronises a document's latest state with its language server: opens it on first sight, and
   * sends the new text on subsequent changes. Documents without a saved path, without a supporting
   * server, or outside the workspace root are ignored.
   * @param state The document's current state.
   */
  public syncDocument(state: LspDocumentState): void {
    if (this.api === undefined || state.path === null) {
      return;
    }
    const serverId: string | undefined = LANGUAGE_SERVERS[state.languageId];
    if (serverId === undefined || this.lspSettings.isDisabled(serverId)) {
      return;
    }
    const resolved: { root: string; standalone: boolean } | null = this.documentRoot(state.path);
    if (resolved === null) {
      return;
    }
    const key: string = this.normalise(state.path);
    const existing: TrackedDocument | undefined = this.tracked.get(key);
    if (existing === undefined) {
      const tracked: TrackedDocument = {
        documentId: state.documentId,
        uri: this.pathToUri(state.path),
        serverId,
        rootPath: resolved.root,
        standalone: resolved.standalone,
        languageId: state.languageId,
        version: 1,
        opened: false,
        text: '',
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
   * Restarts a running server: tears its session down and re-opens every document it was serving
   * against a fresh one. An explicit stop is silent to the renderer (the main process forgets the
   * session before the process exit fires, so no exit notification is sent), so once stop resolves the
   * session is gone and can be started anew. The status indicator is held in its starting state for
   * the whole cycle, so the menu shows a spinner from the click until the new server reports ready.
   * @param sessionId The session to restart.
   * @returns Returns a promise that resolves once the documents have been queued against the new server.
   */
  public async restart(sessionId: string): Promise<void> {
    const info: { serverId: string; rootPath: string; standaloneFile?: string } | undefined =
      this.sessionInfo.get(sessionId);
    if (this.api === undefined || !this.sessions.has(sessionId) || info === undefined) {
      return;
    }
    this.status.setState(sessionId, 'starting');
    await this.api.stop(sessionId);
    this.sessions.delete(sessionId);
    this.legends.delete(sessionId);
    const documents: TrackedDocument[] = [...this.tracked.values()].filter(
      (tracked: TrackedDocument): boolean =>
        `${tracked.rootPath}::${tracked.serverId}` === sessionId,
    );
    // With open documents, re-open each against a fresh server: its first diagnostics flip the
    // indicator back to ready. With none, the server has nothing to analyse and would otherwise spin
    // forever, so start the bare process and mark it ready once its handshake completes — keeping it
    // listed rather than vanishing.
    if (documents.length === 0) {
      const started: boolean = await this.startSession(
        sessionId,
        info.serverId,
        info.rootPath,
        info.standaloneFile,
      );
      if (started) {
        this.status.setState(sessionId, 'ready');
      }
      return;
    }
    for (const tracked of documents) {
      tracked.opened = false;
      this.enqueue(tracked, (): Promise<void> => this.reopen(tracked));
    }
  }

  /**
   * Starts a server for a root ahead of any document opening, so a workspace that is known to need it
   * (such as a .NET solution) begins loading as soon as it opens rather than on the first file. Does
   * nothing when the bridge is absent, the server is disabled, or its session is already running.
   * @param serverId The identifier of the server to start.
   * @param rootPath The root the server is rooted at.
   */
  public prestartServer(serverId: string, rootPath: string): void {
    if (this.api === undefined || this.lspSettings.isDisabled(serverId)) {
      return;
    }
    const sessionId: string = `${rootPath}::${serverId}`;
    if (this.sessions.has(sessionId)) {
      return;
    }
    void this.startSession(sessionId, serverId, rootPath);
  }

  /**
   * Resolves the root a document's server session is rooted at, so the active workspace can be scoped
   * to its servers. Returns null for a document this client has not tracked against a server.
   * @param documentId The identifier of the document.
   * @returns Returns the session root path, or null.
   */
  public rootForDocument(documentId: string): string | null {
    for (const tracked of this.tracked.values()) {
      if (tracked.documentId === documentId) {
        return tracked.rootPath;
      }
    }
    return null;
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
    this.legends.clear();
    this.sessionInfo.clear();
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
    const sessionId: string | null = await this.ensureSession(tracked);
    if (sessionId === null || this.api === undefined) {
      return;
    }
    // The server is now the authority for this language: turn off Monaco's built-in worker
    // diagnostics so its (project-blind) errors no longer compete with the server's. Done only on a
    // successful start, so a server that fails to launch leaves Monaco's diagnostics as a fallback.
    this.suppressBuiltInDiagnostics(tracked.languageId);
    tracked.opened = true;
    tracked.text = content;
    this.api.notify(sessionId, 'textDocument/didOpen', {
      textDocument: {
        uri: tracked.uri,
        languageId: tracked.languageId,
        version: tracked.version,
        text: content,
      },
    });
    // Monaco asked for semantic tokens before the server was ready and cached the empty result; now
    // that the document is open against a running server, ask it to request them again so they paint.
    this.features.refreshSemanticTokens();
  }

  /**
   * Re-opens a document against a freshly restarted server, using the latest text from its live editor
   * model (the client does not retain content, so it reads it back from Monaco).
   * @param tracked The document to re-open.
   * @returns Returns a promise that resolves once the open notification has been sent.
   */
  private async reopen(tracked: TrackedDocument): Promise<void> {
    await this.open(tracked, this.currentContent(tracked));
  }

  /**
   * Reads a tracked document's current text from its live Monaco model, or an empty string when Monaco
   * is unavailable or the document has no live model.
   * @param tracked The document whose text is read.
   * @returns Returns the current text, or an empty string.
   */
  private currentContent(tracked: TrackedDocument): string {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return '';
    }
    const modelUri: string | undefined = this.editors.modelUriForPath(this.uriToPath(tracked.uri));
    if (modelUri === undefined) {
      return '';
    }
    const model: MonacoApi.editor.ITextModel | null = monaco.editor.getModel(
      monaco.Uri.parse(modelUri),
    );
    return model?.getValue() ?? '';
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
    // The content effect can re-fire with unchanged text (a re-render, a metadata change); skip the
    // sync so the server is not handed a redundant whole-document edit.
    if (content === tracked.text) {
      return;
    }
    const sessionId: string | null = await this.ensureSession(tracked);
    if (sessionId === null || this.api === undefined) {
      return;
    }
    tracked.version += 1;
    // Send the edit as a single change replacing the whole previous document with the new text. This
    // carries an explicit range, which servers advertising incremental sync require; a range-less
    // full-text change (valid only under full sync) crashes them.
    this.api.notify(sessionId, 'textDocument/didChange', {
      textDocument: { uri: tracked.uri, version: tracked.version },
      contentChanges: [
        { range: { start: { line: 0, character: 0 }, end: this.endPosition(tracked.text) }, text: content },
      ],
    });
    tracked.text = content;
  }

  /**
   * Computes the end position (the position just past the last character) of a document's text, as the
   * zero-based line and character a server uses to bound a whole-document range.
   * @param text The document text.
   * @returns Returns the end position.
   */
  private endPosition(text: string): LspPosition {
    const newline: number = text.lastIndexOf('\n');
    const line: number = newline < 0 ? 0 : text.slice(0, newline).split('\n').length;
    const character: number = text.length - (newline + 1);
    return { line, character };
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
    const sessionId: string | null = await this.ensureSession(tracked);
    if (sessionId === null) {
      return;
    }
    this.api.notify(sessionId, 'textDocument/didClose', {
      textDocument: { uri: tracked.uri },
    });
  }

  /**
   * Ensures the server for a tracked document is started, at most once per (root, server). The session
   * is rooted at the document's {@link TrackedDocument.rootPath}; for a standalone file the request
   * also names the file so the main process can vouch for its directory.
   * @param tracked The document whose server is started.
   * @returns Returns the session id when the server is running, or null when it failed to start.
   */
  private async ensureSession(tracked: TrackedDocument): Promise<string | null> {
    if (this.api === undefined) {
      return null;
    }
    const sessionId: string = `${tracked.rootPath}::${tracked.serverId}`;
    const pending: Promise<boolean> =
      this.sessions.get(sessionId) ??
      this.startSession(
        sessionId,
        tracked.serverId,
        tracked.rootPath,
        tracked.standalone ? this.uriToPath(tracked.uri) : undefined,
      );
    const started: boolean = await pending;
    return started ? sessionId : null;
  }

  /**
   * Starts a server session, registering it with the status indicator and recording its start
   * parameters so it can later be restarted. The indicator is left in its starting state on success:
   * `initialize` returning does not mean the server can answer yet (heavy servers such as Roslyn and
   * jdtls load the whole project for several seconds afterwards, reporting no progress), so it is held
   * as starting until the first diagnostics arrive, the signal the server has analysed the workspace.
   * @param sessionId The session id to start under.
   * @param serverId The identifier of the server to start.
   * @param rootPath The root the session is rooted at.
   * @param standaloneFile The standalone file the session vouches for, or undefined.
   * @returns Returns the in-flight start promise, resolving true when the server started.
   */
  private startSession(
    sessionId: string,
    serverId: string,
    rootPath: string,
    standaloneFile?: string,
  ): Promise<boolean> {
    if (this.api === undefined) {
      return Promise.resolve(false);
    }
    this.status.register(sessionId, {
      serverId,
      rootPath,
      restart: (): void => void this.restart(sessionId),
    });
    this.sessionInfo.set(sessionId, { serverId, rootPath, standaloneFile });
    const pending: Promise<boolean> = this.api
      .start({ sessionId, serverId, rootPath, standaloneFile })
      .then((result: LspStartResult): boolean => {
        if (!result.success) {
          this.status.setState(sessionId, 'unavailable', result.error);
        }
        if (result.success) {
          this.legends.set(sessionId, this.semanticLegendOf(result.capabilities));
        }
        return result.success;
      });
    this.sessions.set(sessionId, pending);
    return pending;
  }

  /**
   * Handles a server notification, mapping `publishDiagnostics` for one of this client's sessions into
   * the workspace diagnostics aggregate.
   * @param message The notification from a server.
   */
  private onNotification(message: LspMessage): void {
    if (!this.ownsSession(message.sessionId)) {
      return;
    }
    // Roslyn signals it has finished loading the workspace with this notification rather than (or
    // before) any diagnostics, so a clean project still flips from starting to ready and paints
    // semantic tokens. Diagnostics below remain the readiness signal for servers that do not send it.
    if (message.method === 'workspace/projectInitializationComplete') {
      this.status.setState(message.sessionId, 'ready');
      this.features.refreshSemanticTokens();
      return;
    }
    if (message.method !== 'textDocument/publishDiagnostics') {
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
    // Diagnostics arriving mean the server has finished loading the workspace and analysed the
    // document: flip the indicator from starting to ready, and ask Monaco to re-request semantic
    // tokens (it cached an empty result earlier, before the server was ready) so highlighting paints.
    this.status.setState(message.sessionId, 'ready');
    this.features.refreshSemanticTokens();
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
    this.legends.delete(exit.sessionId);
    this.sessionInfo.delete(exit.sessionId);
    this.status.remove(exit.sessionId);
    for (const tracked of this.tracked.values()) {
      if (`${tracked.rootPath}::${tracked.serverId}` === exit.sessionId) {
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
   * Resolves the root a document's server session is rooted at. A document inside the open workspace
   * folder is rooted at that folder; when no folder is open, the document is treated as standalone and
   * rooted at its own parent directory. A document outside the open folder is not handled here (it
   * belongs to no workspace this client owns).
   * @param filePath The document's absolute path.
   * @returns Returns the root and whether it is standalone, or null when the document is not handled.
   */
  private documentRoot(filePath: string): { root: string; standalone: boolean } | null {
    const listing: DirectoryListing | null = this.workspace.root();
    if (listing !== null) {
      return this.isWithin(filePath, listing.path)
        ? { root: listing.path, standalone: false }
        : null;
    }
    return { root: this.parentDir(filePath), standalone: true };
  }

  /**
   * Gets the parent directory of a path, normalised to forward slashes (the main process resolves it
   * back to a platform path, so the slash form is portable).
   * @param filePath The path whose parent directory is taken.
   * @returns Returns the parent directory.
   */
  private parentDir(filePath: string): string {
    const slashed: string = filePath.replace(/\\/g, '/');
    const index: number = slashed.lastIndexOf('/');
    return index <= 0 ? slashed : slashed.slice(0, index);
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
