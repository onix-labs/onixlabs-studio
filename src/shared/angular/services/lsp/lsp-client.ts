import { effect, inject, OnDestroy, Service, untracked } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Bridge } from '@shared/api/bridge';
import { Log } from '@shared/angular/services/log/log';
import {
  LspApplyEditReply,
  LspBraceStyle,
  LspApplyEditRequest,
  LspChannel,
  LspExit,
  LspMessage,
  LspSemanticTokensLegend,
  LspServerSummary,
  LspStartResult,
  REFRESH_WORKSPACE_DIAGNOSTICS_METHOD,
  WORKSPACE_DIAGNOSTICS_METHOD,
} from '@shared/api/lsp-channels';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Diagnostic, Diagnostics } from '../diagnostics/diagnostics';
import { Output } from '../output/output';
import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import {
  LspCodeActionSupport,
  LspDocumentRef,
  LspFeatures,
  LspFormattingSupport,
  LspNavigationSupport,
  LspRenameSupport,
  LspSessionSupport,
} from './lsp-features';
import {
  fromLspWorkspaceEdit,
  SkippedEdit,
  WorkspaceEditOutcome,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { LSP_MARKER_OWNER } from './lsp-marker-owner';
import {
  isMetadataAsSource,
  isWithin,
  normalise,
  parentDir,
  pathToUri,
  uriToPath,
} from './lsp-paths';
import { toDiagnostic, toMarkerData } from './lsp-diagnostic-mapper';
import { LspContentEdit, minimalReplaceEdit } from './lsp-text-sync';
import {
  codeActionSupportOf,
  executeCommandsOf,
  formattingSupportOf,
  navigationSupportOf,
  renameSupportOf,
  saveIncludesText,
  semanticLegendOf,
  supportsPullDiagnostics,
} from './lsp-capabilities';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { Settings } from '@shared/angular/services/settings/settings';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { LanguageSupportPrompt } from '@shared/angular/services/plugins/language-support-prompt';
import { LspStatus } from './lsp-status';
import { completionSupportOf, signatureHelpSupportOf } from './lsp-completion';

/**
 * The configuration section of the setting that chooses whether a server restores packages by itself
 * or asks first (#1143) — Roslyn's, the server that declares it.
 */
const AUTOMATIC_RESTORE_SECTION: string = 'projects.dotnet_enable_automatic_restore';

/**
 * Matches the warning Roslyn logs for a project whose packages are not restored, capturing its path —
 * with automatic restore off, the only word it gives (#1143).
 */
const UNRESOLVED_PROJECT: RegExp = /Project (.+?\.[a-z]+proj) has unresolved dependencies/;

/**
 * The request that asks Roslyn to restore projects' packages.
 */
const RESTORE_METHOD: string = 'workspace/_roslyn_restore';

/**
 * How long to gather projects a load reports as needing a restore before offering to restore them.
 */
const UNRESTORED_GATHER_MS: number = 1_500;

/**
 * The time within which a server's errors and warnings count as one burst, updating one toast with a
 * count rather than raising another (#1134).
 */
const SERVER_PROBLEM_BURST_MS: number = 60_000;

/**
 * The parameters a session was started with, kept so a restart can bring its server back up.
 */
interface LspSessionInfo {
  /**
   * Gets the server's identifier.
   */
  readonly serverId: string;

  /**
   * Gets the root the session is rooted at.
   */
  readonly rootPath: string;

  /**
   * Gets the standalone file the session vouches for, if any.
   */
  readonly standaloneFile?: string;

  /**
   * Gets the language of the document the session was started for, if known.
   */
  readonly languageId?: string;

  /**
   * Gets the brace style the server was started with (#1177), for a server that takes one.
   */
  readonly braceStyle?: LspBraceStyle;
}
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
export interface LspDiagnostic {
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

  /**
   * Gets the diagnostic's code (for example `CS0246`), or undefined. Shown with the marker, and sent
   * back with a code-action request (#1016): servers find their fixes by it.
   */
  readonly code?: number | string;

  /**
   * Gets whatever the server attached to the diagnostic for itself, or undefined. Never read here, but
   * kept and sent back with a code-action request (#1016): servers such as Roslyn resolve their fixes
   * from it.
   */
  readonly data?: unknown;
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
   * Holds the text the document last had on disk as far as this client has been told, so a save is
   * recognised as the saved text changing rather than re-announced on every re-render. Null until the
   * first saved text is reported.
   */
  savedText: string | null;

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
 * Identifies this provider's contribution within the {@link Diagnostics} aggregate.
 */
const PROVIDER_ID: string = 'lsp';

/**
 * How many unsolicited exits a session may accumulate before the automatic restart stops for good
 * (until a manual restart clears the count). Cumulative, not windowed: a server that OOM-crashes
 * every minute under a too-large workspace never trips a rolling window, yet each respawn re-runs
 * the whole workspace load — a treadmill that once kept a machine saturated indefinitely.
 */
const MAX_AUTO_RESTARTS: number = 5;

/**
 * The base delay before a crashed session may be restarted automatically. Each further crash doubles
 * it (up to {@link CRASH_BACKOFF_MAX_MS}), so a struggling server gets progressively longer breathers
 * instead of an immediate respawn on the next keystroke.
 */
const CRASH_BACKOFF_BASE_MS: number = 5_000;

/**
 * The ceiling on the crash-restart backoff.
 */
const CRASH_BACKOFF_MAX_MS: number = 300_000;

/**
 * How long a failed start blocks another automatic attempt, so a server that cannot come up is not
 * re-spawned on every keystroke.
 */
const START_RETRY_COOLDOWN_MS: number = 30_000;

/**
 * How many failed starts are attempted before the server is left unavailable until a manual restart.
 */
const MAX_START_ATTEMPTS: number = 3;

/**
 * The servers that answer semantic-token requests from frozen, partially-loaded compilations while
 * their workspace loads (every identifier classifies as a plain variable). Their tokens are held back
 * in favour of the heuristic colouring until the session settles.
 */
const FROZEN_TOKEN_SERVERS: ReadonlySet<string> = new Set<string>(['csharp']);

/**
 * How long a session's refresh signals must stay quiet before its recolour pass runs. A loading
 * server emits several `workspace/semanticTokens/refresh` requests as projects land; only a pull
 * issued after the burst settles reliably sees the fully-loaded compilation.
 */
const RECOLOR_QUIET_MS: number = 750;

/**
 * How long typing must stay quiet before a pull-diagnostics request is issued for the edited document,
 * so a pull-based server (Roslyn) is not asked to recompute on every keystroke.
 */
const DIAGNOSTIC_QUIET_MS: number = 400;

/**
 * The delays (in milliseconds) at which a pull-based server's open documents are pulled again after
 * it signals initialization is complete. A document opened during the load was analysed as a loose
 * file; once the solution is in, the server re-analyses it in its project, at a latency of its own —
 * a few spaced pulls catch that result whenever it lands. Each full report replaces the document's
 * set, so redundant pulls (for example on a clean file) are harmless.
 */
const POST_LOAD_PULL_DELAYS_MS: readonly number[] = [500, 1500, 3500];

/**
 * How many documents a recolour pass pulls diagnostics for concurrently. Each pull makes the server
 * build that document's full semantic model, and the pass runs just as a heavy server finishes
 * loading — so the fan-out is kept small.
 */
const RECOLOR_PULL_CONCURRENCY: number = 3;

/**
 * How far apart, per document, the post-load pulls are staggered, so many open documents do not all
 * pull at the same instants against a server that has only just finished loading.
 */
const POST_LOAD_PULL_STAGGER_MS: number = 200;

/**
 * How long a standalone file's server session may sit with no documents before it is stopped. A
 * standalone session is rooted at the file's own directory, so nothing else will ever join it: once
 * its last document closes it serves nothing, yet it used to live until the whole client suspended
 * or was destroyed — one leaked server process per one-off file the user glanced at. Workspace
 * sessions are deliberately NOT reaped this way: a workspace prestarts its servers so the first open
 * is warm, and the hidden-view reap already covers workspaces nobody is looking at. The grace period
 * exists so close-then-reopen (the common way people flick through files) never pays a cold start.
 */
const STANDALONE_DOCUMENTLESS_REAP_MS: number = 5 * 60_000;

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
   * Holds the workspace Output surface, where each server's `window/logMessage` logs stream into a
   * per-server channel.
   */
  private readonly output: Output = inject(Output);

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
   * Holds the applier a server's own edits go through (#1015).
   */
  private readonly applier: WorkspaceEditApplier = inject(WorkspaceEditApplier);

  /**
   * Holds the user's language-server settings, used to skip a server the user has disabled.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Holds the user's settings, read for the brace style a server is told when it starts (#1177).
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the notification store a server's errors and warnings are raised in (#1134).
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Counts the restores Studio has asked for, naming each one's progress token.
   */
  private restores: number = 0;

  /**
   * Holds, per session, the projects reported as needing a restore while the user asks to be asked
   * first, gathered into one offer (#1143).
   */
  private readonly unrestored: Map<string, Set<string>> = new Map<string, Set<string>>();

  /**
   * Holds, per session, the timer that raises the gathered offer to restore.
   */
  private readonly unrestoredTimers: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Holds, per session, the distinct errors and warnings its server has raised in the current burst
   * and when the last arrived, so a burst updates one toast with a count (#1134).
   */
  private readonly serverProblems: Map<string, { messages: ReadonlySet<string>; at: number }> =
    new Map<string, { messages: ReadonlySet<string>; at: number }>();

  /**
   * Holds the prompt that offers to install language support when a document finds none.
   */
  private readonly languageSupport: LanguageSupportPrompt = inject(LanguageSupportPrompt);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the disposer that withdraws this client's document resolver, or null when not registered.
   */
  private featuresDisposer: (() => void) | null = null;

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

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
  private readonly sessionInfo: Map<string, LspSessionInfo> = new Map<string, LspSessionInfo>();

  /**
   * Holds the pending documentless reaps of standalone sessions, keyed by session id (see
   * {@link STANDALONE_DOCUMENTLESS_REAP_MS}).
   */
  private readonly standaloneReapTimers: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Holds each started session's semantic token legend (the server's own ordered token-type and
   * modifier names), or null when the server does not provide semantic tokens.
   */
  private readonly legends: Map<string, LspSemanticTokensLegend | null> = new Map<
    string,
    LspSemanticTokensLegend | null
  >();

  /**
   * Holds how each started session's server renames a symbol (#1015).
   */
  private readonly renameSupport: Map<string, LspRenameSupport> = new Map<
    string,
    LspRenameSupport
  >();

  /**
   * Holds how each started session's server offers code actions (#1016).
   */
  private readonly codeActionSupport: Map<string, LspCodeActionSupport> = new Map<
    string,
    LspCodeActionSupport
  >();

  /**
   * Holds which navigations beyond Go to Definition each started session's server answers (#1142).
   */
  private readonly navigationSupport: Map<string, LspNavigationSupport> = new Map<
    string,
    LspNavigationSupport
  >();

  /**
   * Holds how each started session's server formats code (#1141).
   */
  private readonly formattingSupport: Map<string, LspFormattingSupport> = new Map<
    string,
    LspFormattingSupport
  >();

  /**
   * Holds how each started session's server completes and answers signature help (#1021).
   */
  private readonly assistSupport: Map<string, LspSessionSupport> = new Map<
    string,
    LspSessionSupport
  >();

  /**
   * Holds the commands each started session's server runs through `workspace/executeCommand` (#1016).
   */
  private readonly executeCommands: Map<string, readonly string[]> = new Map<
    string,
    readonly string[]
  >();

  /**
   * Holds the sessions whose server advertises pull diagnostics, so the client requests diagnostics via
   * `textDocument/diagnostic` (Roslyn and other pull-based servers) rather than relying on push.
   */
  private readonly pullCapable: Set<string> = new Set<string>();

  /**
   * Holds the sessions whose server asked for the document text to accompany `didSave`.
   */
  private readonly saveWithText: Set<string> = new Set<string>();

  /**
   * Holds the pending debounced diagnostic-pull timers, keyed by document id.
   */
  private readonly diagnosticTimers: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Holds each session's diagnostics for the files of its workspace (#1144), keyed by session and
   * then by normalised path — open or not; {@link publish} lists those of files that are not open.
   */
  private readonly workspaceDiagnostics: Map<string, Map<string, readonly Diagnostic[]>> = new Map<
    string,
    Map<string, readonly Diagnostic[]>
  >();

  /**
   * Holds the current diagnostics for each document, keyed by document id.
   */
  private readonly diagnosticsByDocument: Map<string, readonly Diagnostic[]> = new Map<
    string,
    readonly Diagnostic[]
  >();

  /**
   * Holds each document's diagnostics exactly as its server sent them — codes, data and all — keyed
   * by document id, so a code-action request can send back the ones at the caret (#1016).
   */
  private readonly serverDiagnostics: Map<string, readonly LspDiagnostic[]> = new Map<
    string,
    readonly LspDiagnostic[]
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
   * Holds the disposer for the server-edit subscription (#1015), or null when not subscribed.
   */
  private applyEditDisposer: (() => void) | null = null;

  /**
   * Holds the disposer for the served-listener subscription, or null when not subscribed.
   */
  private servedDisposer: (() => void) | null = null;

  /**
   * Holds the crash bookkeeping per session — how many unsolicited exits it has accumulated and when
   * the last one happened — driving the exponential restart backoff and the cumulative cap.
   */
  private readonly crashes: Map<string, { count: number; lastAt: number }> = new Map<
    string,
    { count: number; lastAt: number }
  >();

  /**
   * Holds the pending post-load pull timers per session, cancellable when the session exits or this
   * client is destroyed.
   */
  private readonly postLoadPullTimers: Map<string, Set<ReturnType<typeof setTimeout>>> = new Map<
    string,
    Set<ReturnType<typeof setTimeout>>
  >();

  /**
   * Holds, per session, the title of every work-done progress token the server has begun and not yet
   * ended, keyed by token, so a `report` carrying only a message still reads under its title.
   */
  private readonly progressTitles: Map<string, Map<string, string>> = new Map<
    string,
    Map<string, string>
  >();

  /**
   * Holds whether this client's sessions are currently suspended (its view hidden long enough to
   * release its servers), so {@link resume} knows there is something to bring back.
   */
  private suspended: boolean = false;

  /**
   * Holds the failed-start bookkeeping per session: how many automatic attempts have been made and
   * when the last one failed, so retries respect a cooldown and eventually stop.
   */
  private readonly startFailures: Map<string, { attempts: number; lastAt: number }> = new Map<
    string,
    { attempts: number; lastAt: number }
  >();

  /**
   * Tracks the sessions with a recolour pass in flight; the value records whether another pass was
   * requested while it ran, so bursts of refresh signals coalesce into at most one trailing rerun.
   */
  private readonly recoloring: Map<string, boolean> = new Map<string, boolean>();

  /**
   * Holds the pending recolour timer per session, so refresh signals debounce into one trailing pass.
   */
  private readonly recolorTimers: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Holds the sessions whose semantics have settled (a recolour pass completed after their refresh
   * signals went quiet), so their servers' tokens are trusted over the heuristic colouring.
   */
  private readonly settledSessions: Set<string> = new Set<string>();

  /**
   * Initializes a new instance of the {@link LspClient} class, registering its diagnostics provider
   * and subscribing to server notifications when the bridge is available.
   */
  public constructor() {
    // Stop any session whose server has stopped being installed. Uninstalling a language server should
    // stop it, not leave it serving until the window is next reopened — and a plugin removed from the
    // sideload directory is the same situation arriving a different way.
    effect((): void => {
      const installed: ReadonlySet<string> = new Set<string>(
        this.lspSettings.catalogue().map((server: LspServerSummary): string => server.id),
      );
      // Loaded is the gate, not non-empty: uninstalling the only installed server leaves the set
      // legitimately empty, and that is exactly when its session must be stopped.
      if (!this.lspSettings.catalogueLoaded()) {
        return;
      }
      untracked((): void => this.stopUninstalledSessions(installed));
    });
    // A server told the brace style only when it starts is restarted when the style for its
    // language changes, so the setting takes effect without the user restarting it (#1177).
    effect((): void => {
      this.lspSettings.catalogue();
      this.settings.globalTextEditor();
      this.settings.languageOverrides();
      untracked((): void => this.restartForBraceStyle());
    });
    if (this.bridge === undefined) {
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
    this.notificationDisposer = this.bridge.on(
      LspChannel.Notification,
      (...args: unknown[]): void => this.onNotification(args[0] as LspMessage),
    );
    this.exitDisposer = this.bridge.on(LspChannel.ServerExit, (...args: unknown[]): void =>
      this.onExit(args[0] as LspExit),
    );
    this.applyEditDisposer = this.bridge.on(LspChannel.ApplyEdit, (...args: unknown[]): void => {
      void this.onApplyEdit(args[0] as LspApplyEditRequest);
    });
    this.featuresDisposer = this.features.registerDocuments((path: string): LspDocumentRef | null =>
      this.resolveDocument(path),
    );
    // A server that answers feature requests is demonstrably serving, even when it never sends the
    // diagnostics or initialisation notifications the status otherwise waits for — without this, such
    // a server shows as "starting" forever.
    this.servedDisposer = this.features.registerServedListener((sessionId: string): void => {
      if (this.ownsSession(sessionId)) {
        this.markReady(sessionId);
      }
    });
  }

  /**
   * Flips a session's status to ready when it is not already, and asks Monaco to re-request semantic
   * tokens for the session's languages. Acting only on the transition keeps the stream of diagnostics
   * a loading server publishes from firing a full-document token refresh on every push.
   * @param sessionId The session that has proven ready.
   */
  private markReady(sessionId: string): void {
    if (this.status.stateOf(sessionId) === 'ready') {
      return;
    }
    this.status.setState(sessionId, 'ready');
    this.features.refreshSemanticTokens(this.sessionLanguages(sessionId));
  }

  /**
   * Recomputes a session's semantic colouring after its server signals that classification has
   * improved (a project, or a standalone file's virtual project, finished loading). Heavy servers
   * (Roslyn) answer semantic-token requests from frozen, partially-loaded compilations and keep
   * serving that snapshot even after the load completes — types stay classified as plain identifiers
   * no matter how often the tokens are re-requested. Pulling diagnostics forces the server to build
   * each document's full semantic model; only then are Monaco's tokens re-requested, so the upgraded
   * classification actually paints. Signals arriving while a pass runs coalesce into one trailing
   * rerun.
   * @param sessionId The session to recolour.
   */
  private async recolorSession(sessionId: string): Promise<void> {
    if (this.recoloring.has(sessionId)) {
      this.recoloring.set(sessionId, true);
      return;
    }
    this.recoloring.set(sessionId, false);
    try {
      const documents: TrackedDocument[] = [...this.tracked.values()].filter(
        (tracked: TrackedDocument): boolean =>
          tracked.opened && `${tracked.rootPath}::${tracked.serverId}` === sessionId,
      );
      // A bounded number of pulls at a time: each forces the server to build a document's full
      // semantic model, and this pass fires right when a heavy server has just finished loading —
      // an unbounded fan-out over many open documents would be a synchronized load spike.
      const queue: TrackedDocument[] = [...documents];
      const worker: () => Promise<void> = async (): Promise<void> => {
        for (
          let next: TrackedDocument | undefined = queue.shift();
          next !== undefined;
          next = queue.shift()
        ) {
          await this.pullDiagnostics(sessionId, next);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(RECOLOR_PULL_CONCURRENCY, queue.length) }, worker),
      );
      // The pass ran after the session's refresh signals went quiet, so the server's compilation is
      // loaded and its tokens are trustworthy from here on.
      this.settledSessions.add(sessionId);
      this.markReady(sessionId);
      this.features.refreshSemanticTokens(this.sessionLanguages(sessionId));
    } finally {
      const rerun: boolean = this.recoloring.get(sessionId) === true;
      this.recoloring.delete(sessionId);
      if (rerun) {
        void this.recolorSession(sessionId);
      }
    }
  }

  /**
   * Schedules a session's recolour pass to run once its refresh signals have stayed quiet for
   * {@link RECOLOR_QUIET_MS}. A loading server emits a burst of refresh requests as projects land;
   * recolouring on the first would pull against a still-loading compilation and trust its degraded
   * tokens, so only the trailing edge of the burst runs the pass.
   * @param sessionId The session to recolour.
   */
  private scheduleRecolor(sessionId: string): void {
    const pending: ReturnType<typeof setTimeout> | undefined = this.recolorTimers.get(sessionId);
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    this.recolorTimers.set(
      sessionId,
      setTimeout((): void => {
        this.recolorTimers.delete(sessionId);
        void this.recolorSession(sessionId);
      }, RECOLOR_QUIET_MS),
    );
  }

  /**
   * Pulls a document's diagnostics from its server (`textDocument/diagnostic`) and ingests them. This
   * is the source of diagnostics for pull-based servers (notably Roslyn, which does not push
   * `publishDiagnostics`); it also forces such servers to build the document's full semantic model, so
   * a following semantic-token request paints real classifications. Servers without pull support reject
   * the request; the pull is best-effort.
   * @param sessionId The session that owns the document.
   * @param tracked The document whose diagnostics are pulled.
   */
  private async pullDiagnostics(sessionId: string, tracked: TrackedDocument): Promise<void> {
    let result: unknown;
    try {
      result = await this.bridge?.invoke(LspChannel.Request, sessionId, 'textDocument/diagnostic', {
        textDocument: { uri: tracked.uri },
      });
    } catch {
      // Best-effort: the server either lacks pull-diagnostic support or is not ready yet.
      return;
    }
    // A full report carries the document's current diagnostics; an unchanged report (or a server that
    // answers with neither) leaves the existing set in place.
    const report: { kind?: string; items?: readonly LspDiagnostic[] } | null =
      (result as { kind?: string; items?: readonly LspDiagnostic[] } | null) ?? null;
    if (report === null || report.kind === 'unchanged' || !Array.isArray(report.items)) {
      return;
    }
    this.ingestDiagnostics(tracked, report.items);
    this.markReady(sessionId);
  }

  /**
   * Pulls a pull-based server's open documents again once it signals initialization is complete.
   *
   * A document opened while the solution was still loading sat in the server's miscellaneous-files
   * project; once the load completes the server moves it into its real project, and the diagnostics
   * pulled before then are stale. A few spaced pulls collect the real ones as the server analyses.
   * Gated to pull-capable sessions so push-based servers, which report through `publishDiagnostics`,
   * are left untouched.
   *
   * ⛔ This must NOT re-send `textDocument/didOpen`. It used to (#306), on the belief that Roslyn would
   * not otherwise pick the document up — which is no longer so, and the protocol forbids a second
   * open without a close. Roslyn 5.4 treats it as a fatal error: it logs `didOpen received for … which
   * is already open`, then `Error occurred processing queue`, and exits with code 0 — about twelve
   * seconds after every start of a large solution, which was every "crash" in a week of logs. The
   * probe that proved it is `.cache/roslyn-probe/probe.mjs`.
   * @param sessionId The session whose open documents to pull again.
   */
  private pullAfterLoad(sessionId: string): void {
    if (this.bridge === undefined || !this.pullCapable.has(sessionId)) {
      return;
    }
    let index: number = 0;
    for (const tracked of this.tracked.values()) {
      if (`${tracked.rootPath}::${tracked.serverId}` !== sessionId || !tracked.opened) {
        continue;
      }
      // The pulls are staggered per document and cancellable (see {@link clearPostLoadPulls}): a
      // burst of open documents must not hit the just-loaded server at the same instants, and a
      // document that closes or a server that exits meanwhile must not still be pulled for.
      for (const delay of POST_LOAD_PULL_DELAYS_MS) {
        const timers: Set<ReturnType<typeof setTimeout>> =
          this.postLoadPullTimers.get(sessionId) ?? new Set<ReturnType<typeof setTimeout>>();
        this.postLoadPullTimers.set(sessionId, timers);
        const timer: ReturnType<typeof setTimeout> = setTimeout(
          (): void => {
            timers.delete(timer);
            if (tracked.opened) {
              void this.pullDiagnostics(sessionId, tracked);
            }
          },
          delay + index * POST_LOAD_PULL_STAGGER_MS,
        );
        timers.add(timer);
      }
      index += 1;
    }
  }

  /**
   * Cancels a session's pending post-load pulls: the server exited (or this client is being
   * destroyed), so the timers would only pull against a gone or restarted session.
   * @param sessionId The session whose pulls to cancel.
   */
  private clearPostLoadPulls(sessionId: string): void {
    const timers: Set<ReturnType<typeof setTimeout>> | undefined =
      this.postLoadPullTimers.get(sessionId);
    if (timers === undefined) {
      return;
    }
    this.postLoadPullTimers.delete(sessionId);
    for (const timer of timers) {
      clearTimeout(timer);
    }
  }

  /**
   * Records a document's diagnostics (from a push or a pull), sets them as editor markers, and
   * republishes the aggregate.
   * @param tracked The document the diagnostics belong to.
   * @param diagnostics The server's current diagnostics for the document (empty clears them).
   */
  private ingestDiagnostics(tracked: TrackedDocument, diagnostics: readonly LspDiagnostic[]): void {
    this.log.info(
      'LspClient',
      `Received ${diagnostics.length} diagnostic(s) for ${tracked.uri}`,
      tracked.serverId,
    );
    this.diagnosticsByDocument.set(
      tracked.documentId,
      diagnostics.map((diagnostic: LspDiagnostic): Diagnostic =>
        toDiagnostic(diagnostic, { uri: tracked.uri, documentId: tracked.documentId }),
      ),
    );
    this.serverDiagnostics.set(tracked.documentId, diagnostics);
    this.setMarkers(tracked, diagnostics);
    this.publish();
  }

  /**
   * Schedules a debounced diagnostic pull for a document edited on a pull-based server, so live typing
   * refreshes its errors without a request per keystroke.
   * @param sessionId The session that owns the document.
   * @param tracked The document to pull after typing settles.
   */
  private scheduleDiagnostics(sessionId: string, tracked: TrackedDocument): void {
    const pending: ReturnType<typeof setTimeout> | undefined = this.diagnosticTimers.get(
      tracked.documentId,
    );
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    this.diagnosticTimers.set(
      tracked.documentId,
      setTimeout((): void => {
        this.diagnosticTimers.delete(tracked.documentId);
        void this.pullDiagnostics(sessionId, tracked);
      }, DIAGNOSTIC_QUIET_MS),
    );
  }

  /**
   * Collects the Monaco language identifiers of the documents a session serves, so a semantic-token
   * refresh can be scoped to them.
   * @param sessionId The session whose languages are collected.
   * @returns Returns the session's distinct document languages.
   */
  private sessionLanguages(sessionId: string): readonly string[] {
    const languages: Set<string> = new Set<string>();
    for (const tracked of this.tracked.values()) {
      if (`${tracked.rootPath}::${tracked.serverId}` === sessionId) {
        languages.add(tracked.languageId);
      }
    }
    return [...languages];
  }

  /**
   * Resolves a file path to the open document a feature request targets, for this workspace's editor
   * features. Returns null for paths this client does not own or has not opened against a server.
   * @param path The absolute file path to resolve.
   * @returns Returns the document reference, or null.
   */
  private resolveDocument(path: string): LspDocumentRef | null {
    const tracked: TrackedDocument | undefined = this.tracked.get(normalise(path));
    if (!tracked?.opened) {
      return null;
    }
    const sessionId: string = `${tracked.rootPath}::${tracked.serverId}`;
    return {
      sessionId,
      uri: tracked.uri,
      semanticLegend: this.legends.get(sessionId) ?? null,
      // Roslyn serves degraded tokens (every identifier a plain variable) from frozen partial
      // compilations while its workspace loads; hold its tokens back until the session settles so the
      // editor goes heuristic → correct in one step instead of flashing the degraded colours between.
      suppressServerTokens:
        FROZEN_TOKEN_SERVERS.has(tracked.serverId) && !this.settledSessions.has(sessionId),
      rename: this.renameSupport.get(sessionId) ?? 'none',
      codeActions: this.codeActionSupport.get(sessionId) ?? 'none',
      commands: this.executeCommands.get(sessionId) ?? [],
      formatting: this.formattingSupport.get(sessionId),
      navigation: this.navigationSupport.get(sessionId),
      completion: this.assistSupport.get(sessionId)?.completion ?? null,
      signatureHelp: this.assistSupport.get(sessionId)?.signatureHelp ?? null,
      diagnostics: this.serverDiagnostics.get(tracked.documentId) ?? [],
      sync: (text: string): Promise<void> => this.change(tracked, text),
    };
  }

  /**
   * Synchronises a document's latest state with its language server: opens it on first sight, and
   * sends the new text on subsequent changes. Documents without a saved path, without a supporting
   * server, or outside the workspace root are ignored.
   * @param state The document's current state.
   */
  public syncDocument(state: LspDocumentState): void {
    if (this.bridge === undefined || state.path === null) {
      return;
    }
    const serverId: string | null = this.lspSettings.serverForLanguage(state.languageId);
    if (serverId === null) {
      // No server serves this language. That may be because none exists, or because the plugin that
      // would provide one has not been installed — the prompt tells those apart and only speaks up for
      // the second.
      this.languageSupport.offerFor(state.languageId);
      // The catalogue is loaded asynchronously from the main process, so a document opened before it
      // arrives would otherwise be read as "this language has no server" and left unserved for the
      // life of the tab. Retry once the catalogue lands; if the language genuinely has no server the
      // retry resolves to null again and stops there.
      //
      // Gated on the catalogue having LOADED, not on it being empty. An empty catalogue is also the
      // legitimate answer once no plugin contributes a server — and then `ready` has long since
      // settled, so retrying on emptiness re-enters this branch on the very next microtask, forever,
      // in a chain that never yields to the event loop. That froze the renderer the moment the last
      // language server was uninstalled with a document of its language open.
      if (!this.lspSettings.catalogueLoaded()) {
        void this.lspSettings.ready.then((): void => this.syncDocument(state));
      }
      return;
    }
    if (this.lspSettings.isDisabled(serverId)) {
      return;
    }
    const resolved: { root: string; standalone: boolean } | null = this.documentRoot(state.path);
    if (resolved === null) {
      return;
    }
    const key: string = normalise(state.path);
    const existing: TrackedDocument | undefined = this.tracked.get(key);
    if (existing === undefined) {
      // The document may have moved (save-as, a rename in the Explorer or by an agent): the server
      // must be told the old URI closed, or it keeps both open — and the eventual close finds the
      // stale registration first and leaves the live one behind.
      this.closeDocument(state.documentId);
      const tracked: TrackedDocument = {
        documentId: state.documentId,
        uri: pathToUri(state.path),
        serverId,
        rootPath: resolved.root,
        standalone: resolved.standalone,
        languageId: state.languageId,
        version: 1,
        opened: false,
        savedText: null,
        text: '',
        queue: Promise.resolve(),
      };
      this.tracked.set(key, tracked);
      // An opened file's errors now come from its own pull: its workspace report leaves the list at
      // once rather than lingering until something else republishes (#1144).
      if ([...this.workspaceDiagnostics.values()].some((files) => files.has(key))) {
        this.publish();
      }
      this.enqueue(tracked, (): Promise<void> => this.open(tracked, state.content));
    } else {
      existing.languageId = state.languageId;
      this.enqueue(existing, (): Promise<void> => this.change(existing, state.content));
    }
  }

  /**
   * Reports a document's current saved text. The first report only records the baseline; a later
   * report with different text is a save, and the server is told through `textDocument/didSave`
   * (carrying the text when it asked for it). Servers that recompute on save — gopls, jdtls, the
   * eslint family — otherwise wait forever for a notification the client advertised but never sent.
   * @param documentId The identifier of the document.
   * @param savedText The document's text as last written to disk.
   */
  public notifySaved(documentId: string, savedText: string): void {
    const tracked: TrackedDocument | undefined = [...this.tracked.values()].find(
      (candidate: TrackedDocument): boolean => candidate.documentId === documentId,
    );
    if (tracked === undefined) {
      return;
    }
    const previous: string | null = tracked.savedText;
    tracked.savedText = savedText;
    if (previous === null || previous === savedText) {
      return;
    }
    this.enqueue(tracked, (): Promise<void> => this.save(tracked, savedText));
  }

  /**
   * Closes a document, sending `textDocument/didClose` and dropping its diagnostics. Closing the
   * last document of a standalone session arms its documentless reap (see
   * {@link STANDALONE_DOCUMENTLESS_REAP_MS}).
   * @param documentId The identifier of the document to close.
   */
  public closeDocument(documentId: string): void {
    for (const [key, tracked] of this.tracked) {
      if (tracked.documentId !== documentId) {
        continue;
      }
      this.tracked.delete(key);
      this.diagnosticsByDocument.delete(documentId);
      this.serverDiagnostics.delete(documentId);
      this.setMarkers(tracked, []);
      this.publish();
      this.enqueue(tracked, (): Promise<void> => this.close(tracked));
      if (tracked.standalone) {
        this.armStandaloneReap(`${tracked.rootPath}::${tracked.serverId}`);
      }
      return;
    }
  }

  /**
   * Arms the documentless reap for a standalone session, unless another tracked document still maps
   * to it (several one-off files from one directory share a session).
   * @param sessionId The standalone session to reap once its grace period passes documentless.
   */
  private armStandaloneReap(sessionId: string): void {
    if (!this.sessions.has(sessionId) || this.hasDocumentsFor(sessionId)) {
      return;
    }
    this.clearStandaloneReap(sessionId);
    this.standaloneReapTimers.set(
      sessionId,
      setTimeout((): void => {
        this.standaloneReapTimers.delete(sessionId);
        // A document may have opened (and closed again, re-arming) during the grace period.
        if (!this.sessions.has(sessionId) || this.hasDocumentsFor(sessionId)) {
          return;
        }
        this.log.info('LspClient', `Stopping documentless standalone session`, sessionId);
        void this.bridge?.invoke(LspChannel.Stop, sessionId);
        this.status.remove(sessionId);
        this.legends.delete(sessionId);
        this.pullCapable.delete(sessionId);
        this.settledSessions.delete(sessionId);
        this.clearPostLoadPulls(sessionId);
        this.sessions.delete(sessionId);
      }, STANDALONE_DOCUMENTLESS_REAP_MS),
    );
  }

  /**
   * Cancels a session's pending documentless reap, if any.
   * @param sessionId The session whose reap is cancelled.
   */
  private clearStandaloneReap(sessionId: string): void {
    const timer: ReturnType<typeof setTimeout> | undefined =
      this.standaloneReapTimers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.standaloneReapTimers.delete(sessionId);
    }
  }

  /**
   * Determines whether any tracked document maps to a session.
   * @param sessionId The session to test.
   * @returns Returns true when at least one tracked document belongs to it.
   */
  private hasDocumentsFor(sessionId: string): boolean {
    for (const tracked of this.tracked.values()) {
      if (`${tracked.rootPath}::${tracked.serverId}` === sessionId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Restarts a server. The main process owns the restart: it tears the server down whatever its
   * reference count, respawns it under the same session id, and tells every client holding it — this
   * one included — through an exit flagged `restarted`, on which {@link onExit} re-opens the client's
   * documents against the new server. When the main process has no such session (the last start
   * failed, or the server crashed and was torn down), the client simply starts afresh itself. The
   * status indicator is held in its starting state for the whole cycle.
   * @param sessionId The session to restart.
   * @param braceStyle The brace style to start the new server with, when it changed (#1177).
   * @returns Returns a promise that resolves once the restart has been requested (and, when the client
   * starts afresh itself, once its documents have been queued against the new server).
   */
  public async restart(sessionId: string, braceStyle?: LspBraceStyle): Promise<void> {
    const info: LspSessionInfo | undefined = this.sessionInfo.get(sessionId);
    if (this.bridge === undefined || info === undefined) {
      return;
    }
    // A manual restart is an explicit vote of confidence: clear the crash-loop and failed-start
    // bookkeeping so the session gets a fresh set of automatic attempts.
    this.crashes.delete(sessionId);
    this.startFailures.delete(sessionId);
    this.status.setState(sessionId, 'starting');
    this.log.info('LspClient', `Restarting server '${info.serverId}'`, sessionId);
    let result: LspStartResult;
    try {
      result =
        braceStyle === undefined
          ? await this.bridge.invoke<LspStartResult>(LspChannel.Restart, sessionId)
          : await this.bridge.invoke<LspStartResult>(LspChannel.Restart, sessionId, braceStyle);
    } catch (error: unknown) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : 'The language server failed to restart.',
      };
    }
    if (result.success || result.error !== 'No such session') {
      // The main process restarted (or failed to restart) a running session; its `restarted` exit
      // drives the re-open, and a failure surfaces through the ordinary start path when it does.
      return;
    }
    // Nothing was running to restart: start afresh from here.
    this.sessions.delete(sessionId);
    this.legends.delete(sessionId);
    await this.reattach(sessionId);
  }

  /**
   * Re-opens every document a session was serving against its (fresh) server, starting the bare
   * server when the session serves none so it stays listed rather than vanishing.
   * @param sessionId The session to re-attach to.
   * @returns Returns a promise that resolves once the documents have been queued (or the bare server
   * has started).
   */
  private async reattach(sessionId: string): Promise<void> {
    const info: LspSessionInfo | undefined = this.sessionInfo.get(sessionId);
    if (info === undefined) {
      return;
    }
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
        info.languageId,
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
  /**
   * Gets the brace style a server is told when it starts a session for a language (#1177): the user's
   * Brace style for the language — its override, or the global setting — for a server that takes it.
   * @param serverId The server.
   * @param languageId The language the session is started for.
   * @returns Returns the brace style, or undefined for a server that does not take one.
   */
  private braceStyleFor(serverId: string, languageId: string): LspBraceStyle | undefined {
    const takes: boolean = this.lspSettings
      .catalogue()
      .some(
        (server: LspServerSummary): boolean =>
          server.id === serverId && server.takesBraceStyle === true,
      );
    return takes ? this.settings.resolveSettingsForLanguage(languageId).braceStyle : undefined;
  }

  /**
   * Restarts each session whose server takes the brace style at start, where the style for its
   * language is no longer the one it was started with (#1177).
   */
  private restartForBraceStyle(): void {
    for (const [sessionId, info] of [...this.sessionInfo.entries()]) {
      if (info.languageId === undefined) {
        continue;
      }
      const braceStyle: LspBraceStyle | undefined = this.braceStyleFor(
        info.serverId,
        info.languageId,
      );
      if (braceStyle === undefined || braceStyle === info.braceStyle) {
        continue;
      }
      this.log.info('LspClient', `Brace style is now '${braceStyle}'; restarting`, sessionId);
      this.sessionInfo.set(sessionId, { ...info, braceStyle });
      void this.restart(sessionId, braceStyle);
    }
  }

  /**
   * Stops the running sessions whose server is no longer installed, and forgets the documents that were
   * being served by them so a later install starts cleanly.
   *
   * Only called once the catalogue has loaded: before that an empty set means "not known yet", not
   * "everything was uninstalled", and tearing down on it would kill every session at startup.
   * @param installed The identifiers of the servers still installed.
   */
  private stopUninstalledSessions(installed: ReadonlySet<string>): void {
    for (const [sessionId, info] of [...this.sessionInfo.entries()]) {
      if (installed.has(info.serverId)) {
        continue;
      }
      this.log.info(
        'LspClient',
        `Stopping '${info.serverId}'; it is no longer installed`,
        sessionId,
      );
      void this.bridge?.invoke(LspChannel.Stop, sessionId);
      this.sessions.delete(sessionId);
      this.sessionInfo.delete(sessionId);
      this.status.remove(sessionId);
      this.legends.delete(sessionId);
      this.pullCapable.delete(sessionId);
      this.settledSessions.delete(sessionId);
      this.clearPostLoadPulls(sessionId);
    }
    const orphaned: Set<string> = new Set<string>();
    for (const [key, tracked] of [...this.tracked.entries()]) {
      if (!installed.has(tracked.serverId)) {
        this.tracked.delete(key);
        orphaned.add(tracked.languageId);
      }
    }
    // The documents just left unserved would otherwise sit silent until their next edit; offer the
    // support back right away, the way a fresh open would.
    for (const language of orphaned) {
      this.languageSupport.offerFor(language);
    }
  }

  /**
   * Suspends this client's sessions: each is stopped (the main process tears the server down once no
   * other client shares it) and every tracked document is marked unopened, while the client itself
   * stays fully usable. Called when this client's view has been hidden long enough that keeping a
   * multi-gigabyte language server hot for it is a waste — {@link resume} brings everything back.
   */
  public suspend(): void {
    if (this.sessions.size === 0) {
      return;
    }
    this.suspended = true;
    this.log.debug('LspClient', `Suspending ${this.sessions.size} session(s)`);
    for (const sessionId of [...this.sessions.keys()]) {
      void this.bridge?.invoke(LspChannel.Stop, sessionId);
      this.status.remove(sessionId);
      this.legends.delete(sessionId);
      this.pullCapable.delete(sessionId);
      this.settledSessions.delete(sessionId);
      this.clearPostLoadPulls(sessionId);
      this.clearStandaloneReap(sessionId);
    }
    this.sessions.clear();
    for (const tracked of this.tracked.values()) {
      tracked.opened = false;
    }
  }

  /**
   * Resumes a suspended client: every tracked document is re-opened, lazily starting fresh sessions
   * exactly as the original opens did. A client that was never suspended is left untouched.
   */
  public resume(): void {
    if (!this.suspended) {
      return;
    }
    this.suspended = false;
    for (const tracked of this.tracked.values()) {
      this.enqueue(tracked, (): Promise<void> => this.reopen(tracked));
    }
  }

  public prestartServer(serverId: string, rootPath: string): void {
    if (this.bridge === undefined || this.lspSettings.isDisabled(serverId)) {
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
    this.applyEditDisposer?.();
    this.featuresDisposer?.();
    this.servedDisposer?.();
    for (const sessionId of this.sessions.keys()) {
      void this.bridge?.invoke(LspChannel.Stop, sessionId);
      this.status.remove(sessionId);
    }
    for (const timer of this.diagnosticTimers.values()) {
      clearTimeout(timer);
    }
    this.diagnosticTimers.clear();
    for (const timer of this.standaloneReapTimers.values()) {
      clearTimeout(timer);
    }
    this.standaloneReapTimers.clear();
    for (const timer of this.unrestoredTimers.values()) {
      clearTimeout(timer);
    }
    this.unrestoredTimers.clear();
    this.unrestored.clear();
    for (const sessionId of [...this.postLoadPullTimers.keys()]) {
      this.clearPostLoadPulls(sessionId);
    }
    for (const timer of this.recolorTimers.values()) {
      clearTimeout(timer);
    }
    this.recolorTimers.clear();
    this.sessions.clear();
    this.legends.clear();
    this.renameSupport.clear();
    this.codeActionSupport.clear();
    this.formattingSupport.clear();
    this.navigationSupport.clear();
    for (const sessionId of this.assistSupport.keys()) {
      this.features.setSessionSupport(sessionId, null);
    }
    this.assistSupport.clear();
    this.executeCommands.clear();
    this.serverDiagnostics.clear();
    this.pullCapable.clear();
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
    if (sessionId === null || this.bridge === undefined) {
      return;
    }
    // The server is now the authority for this language: turn off Monaco's built-in worker
    // diagnostics so its (project-blind) errors no longer compete with the server's. Done only on a
    // successful start, so a server that fails to launch leaves Monaco's diagnostics as a fallback.
    this.suppressBuiltInDiagnostics(tracked.languageId);
    // Format Document, Format Selection and format-on-type for the language, when this server formats
    // (#1141). Registered on demand so the commands are offered only where something will answer.
    const formatting: LspFormattingSupport | undefined = this.formattingSupport.get(sessionId);
    if (formatting !== undefined) {
      this.features.enableFormatting(tracked.languageId, formatting);
    }
    tracked.opened = true;
    tracked.text = content;
    this.bridge.send(LspChannel.Notify, sessionId, 'textDocument/didOpen', {
      textDocument: {
        uri: tracked.uri,
        languageId: tracked.languageId,
        version: tracked.version,
        text: content,
      },
    });
    // Monaco asked for semantic tokens before the server was ready and cached the empty result; now
    // that the document is open against a running server, ask it to request them again (for this
    // document's language only) so they paint.
    this.features.refreshSemanticTokens([tracked.languageId]);
    // Force the server to build this document's full semantic model (heavy servers otherwise answer
    // token requests from a frozen, reference-less snapshot indefinitely), then repaint once it has.
    void this.pullDiagnostics(sessionId, tracked).then((): void => {
      this.features.refreshSemanticTokens([tracked.languageId]);
    });
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
    const modelUri: string | undefined = this.editors.modelUriForPath(uriToPath(tracked.uri));
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
    if (sessionId === null || this.bridge === undefined) {
      return;
    }
    // Send the smallest single ranged edit that turns the previous text into the new one. The
    // explicit range is what servers advertising incremental sync require (a range-less full-text
    // change crashes them), and trimming to the changed span keeps a keystroke in a large file from
    // shipping — and forcing the server to re-process — the whole document.
    const edit: LspContentEdit | null = minimalReplaceEdit(tracked.text, content);
    if (edit === null) {
      return;
    }
    tracked.version += 1;
    this.bridge.send(LspChannel.Notify, sessionId, 'textDocument/didChange', {
      textDocument: { uri: tracked.uri, version: tracked.version },
      contentChanges: [edit],
    });
    tracked.text = content;
    // A pull-based server (Roslyn) does not push diagnostics on change, so pull them once typing
    // settles; push-based servers report through publishDiagnostics and need no pull.
    if (this.pullCapable.has(sessionId)) {
      this.scheduleDiagnostics(sessionId, tracked);
    }
  }

  /**
   * Sends `textDocument/didSave` for an open document, with the text when the server asked for it.
   * @param tracked The document that was saved.
   * @param savedText The text written to disk.
   * @returns Returns a promise that resolves once the notification has been sent.
   */
  private async save(tracked: TrackedDocument, savedText: string): Promise<void> {
    if (!tracked.opened || this.bridge === undefined) {
      return;
    }
    const sessionId: string | null = await this.ensureSession(tracked);
    if (sessionId === null) {
      return;
    }
    this.bridge.send(LspChannel.Notify, sessionId, 'textDocument/didSave', {
      textDocument: { uri: tracked.uri },
      ...(this.saveWithText.has(sessionId) ? { text: savedText } : {}),
    });
  }

  /**
   * Sends `textDocument/didClose` for a document that has been opened.
   * @param tracked The document to close.
   * @returns Returns a promise that resolves once the close notification has been sent.
   */
  private async close(tracked: TrackedDocument): Promise<void> {
    if (!tracked.opened || this.bridge === undefined) {
      return;
    }
    const sessionId: string | null = await this.ensureSession(tracked);
    if (sessionId === null) {
      return;
    }
    this.bridge.send(LspChannel.Notify, sessionId, 'textDocument/didClose', {
      textDocument: { uri: tracked.uri },
    });
    // A closed file's diagnostics are the workspace's to report now, but the server lets its open
    // workspace request wait through a close: have it pulled afresh (#1144).
    this.bridge.send(LspChannel.Notify, sessionId, REFRESH_WORKSPACE_DIAGNOSTICS_METHOD, {
      uri: tracked.uri,
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
    if (this.bridge === undefined) {
      return null;
    }
    const sessionId: string = `${tracked.rootPath}::${tracked.serverId}`;
    // A document (re-)joining the session withdraws any pending documentless reap.
    this.clearStandaloneReap(sessionId);
    const pending: Promise<boolean> =
      this.sessions.get(sessionId) ??
      this.startSession(
        sessionId,
        tracked.serverId,
        tracked.rootPath,
        tracked.standalone ? uriToPath(tracked.uri) : undefined,
        tracked.languageId,
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
   * @param languageId The language of the document the session is started for, or undefined for a
   * session pre-started before any document, which takes its server's language.
   * @returns Returns the in-flight start promise, resolving true when the server started.
   */
  private startSession(
    sessionId: string,
    serverId: string,
    rootPath: string,
    standaloneFile?: string,
    languageId?: string,
  ): Promise<boolean> {
    if (this.bridge === undefined) {
      return Promise.resolve(false);
    }
    // A session pre-started for a workspace has no document yet: it serves its server's language.
    const language: string | undefined =
      languageId ??
      this.lspSettings
        .catalogue()
        .find((server: LspServerSummary): boolean => server.id === serverId)?.languages[0];
    const braceStyle: LspBraceStyle | undefined =
      language === undefined ? undefined : this.braceStyleFor(serverId, language);
    this.sessionInfo.set(sessionId, {
      serverId,
      rootPath,
      standaloneFile,
      languageId: language,
      braceStyle,
    });
    const entry: { serverId: string; rootPath: string; restart: () => void } = {
      serverId,
      rootPath,
      restart: (): void => void this.restart(sessionId),
    };
    // A crash-looping or repeatedly-failing server is left unavailable (with its restart affordance)
    // rather than re-spawned: without this, a server that dies on startup would spin in a
    // spawn/crash cycle driven by every document sync.
    const blockReason: string | null = this.startBlockReason(sessionId);
    if (blockReason !== null) {
      if (this.status.stateOf(sessionId) === null) {
        this.status.register(sessionId, entry);
      }
      this.status.setState(sessionId, 'unavailable', blockReason);
      const blocked: Promise<boolean> = Promise.resolve(false);
      this.sessions.set(sessionId, blocked);
      return blocked;
    }
    // A recent failed start blocks another attempt for a cooldown, without caching the failure, so a
    // later document sync retries once the cooldown has passed. The status row is left exactly as
    // the failure set it — unavailable, with the real reason. Registering here would flip it back to
    // "starting" (and re-arm the readiness watchdog) on every keystroke for a server nothing is
    // starting, which is how a failed resolution used to read as a spinner and then, once typing
    // paused, as a fabricated "did not report ready in time".
    if (this.inStartCooldown(sessionId)) {
      return Promise.resolve(false);
    }
    this.status.register(sessionId, entry);
    this.log.info('LspClient', `Starting server '${serverId}'`, rootPath);
    const pending: Promise<boolean> = this.bridge
      .invoke<LspStartResult>(LspChannel.Start, {
        sessionId,
        serverId,
        rootPath,
        standaloneFile,
        ...(braceStyle === undefined ? {} : { braceStyle }),
      })
      .then((result: LspStartResult): boolean => {
        if (!result.success) {
          this.status.setState(sessionId, 'unavailable', result.error);
          this.log.error('LspClient', `Server '${serverId}' failed to start`, result.error);
          this.recordStartFailure(sessionId);
          // Forget the failed session so a sync after the cooldown can try again; the attempt cap in
          // startBlockReason stops this from retrying forever.
          this.sessions.delete(sessionId);
        }
        if (result.success) {
          this.startFailures.delete(sessionId);
          this.legends.set(sessionId, semanticLegendOf(result.capabilities));
          this.renameSupport.set(sessionId, renameSupportOf(result.capabilities));
          this.codeActionSupport.set(sessionId, codeActionSupportOf(result.capabilities));
          this.formattingSupport.set(sessionId, formattingSupportOf(result.capabilities));
          this.navigationSupport.set(sessionId, navigationSupportOf(result.capabilities));
          this.executeCommands.set(sessionId, executeCommandsOf(result.capabilities));
          const assist: LspSessionSupport = {
            completion: completionSupportOf(result.capabilities),
            signatureHelp: signatureHelpSupportOf(result.capabilities),
          };
          this.assistSupport.set(sessionId, assist);
          // The completion and signature-help providers trigger on every session's characters.
          this.features.setSessionSupport(sessionId, assist);
          const pull: boolean = supportsPullDiagnostics(result.capabilities);
          if (pull) {
            this.pullCapable.add(sessionId);
          }
          if (saveIncludesText(result.capabilities)) {
            this.saveWithText.add(sessionId);
          } else {
            this.saveWithText.delete(sessionId);
          }
          this.log.info(
            'LspClient',
            `Server '${serverId}' started (capabilities negotiated)`,
            `pullDiagnostics=${pull}`,
          );
        }
        return result.success;
      })
      .catch((error: unknown): boolean => {
        // A rejected start invoke (for example the main process stalling under a heavy build) would
        // otherwise leave the session registered as starting forever, and — because this rejected
        // promise stays cached in `this.sessions` — every later open would re-throw it until the app
        // restarts. Treat it exactly like a failed start: surface it, record the failure for the
        // cooldown, and forget the session so a later sync can retry.
        this.status.setState(
          sessionId,
          'unavailable',
          error instanceof Error ? error.message : 'The language server failed to start.',
        );
        this.log.error('LspClient', `Server '${serverId}' start invoke rejected`, error);
        this.recordStartFailure(sessionId);
        this.sessions.delete(sessionId);
        return false;
      });
    this.sessions.set(sessionId, pending);
    return pending;
  }

  /**
   * Determines why a session must not be started automatically, or null when a start is allowed. A
   * session is blocked once its server has crashed repeatedly within the crash window, or once it has
   * exhausted its automatic start attempts; a manual restart clears both.
   * @param sessionId The session about to start.
   * @returns Returns the human-readable block reason, or null when the start may proceed.
   */
  private startBlockReason(sessionId: string): string | null {
    const crash: { count: number; lastAt: number } | undefined = this.crashes.get(sessionId);
    if (crash !== undefined && crash.count >= MAX_AUTO_RESTARTS) {
      return 'The server crashed repeatedly and was stopped. Restart it to try again.';
    }
    const failure: { attempts: number; lastAt: number } | undefined =
      this.startFailures.get(sessionId);
    if (failure !== undefined && failure.attempts >= MAX_START_ATTEMPTS) {
      return 'The server failed to start repeatedly. Restart it to try again.';
    }
    return null;
  }

  /**
   * Determines whether a session must wait before another automatic start: a recent failed start
   * respects its fixed cooldown, and a crashed server respects an exponential backoff (doubling per
   * accumulated crash) — each respawn replays the server's whole workspace load, so a struggling
   * server must not be revived on every keystroke.
   * @param sessionId The session about to start.
   * @returns Returns true when the session is within a cooldown or backoff.
   */
  private inStartCooldown(sessionId: string): boolean {
    const failure: { attempts: number; lastAt: number } | undefined =
      this.startFailures.get(sessionId);
    if (failure !== undefined && Date.now() - failure.lastAt < START_RETRY_COOLDOWN_MS) {
      return true;
    }
    const crash: { count: number; lastAt: number } | undefined = this.crashes.get(sessionId);
    if (crash === undefined) {
      return false;
    }
    const backoff: number = Math.min(
      CRASH_BACKOFF_BASE_MS * 2 ** (crash.count - 1),
      CRASH_BACKOFF_MAX_MS,
    );
    return Date.now() - crash.lastAt < backoff;
  }

  /**
   * Records a failed start attempt for a session, feeding the retry cooldown and the attempt cap.
   * @param sessionId The session whose start failed.
   */
  private recordStartFailure(sessionId: string): void {
    const failure: { attempts: number; lastAt: number } | undefined =
      this.startFailures.get(sessionId);
    this.startFailures.set(sessionId, {
      attempts: (failure?.attempts ?? 0) + 1,
      lastAt: Date.now(),
    });
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
      this.markReady(message.sessionId);
      this.pullAfterLoad(message.sessionId);
      this.scheduleRecolor(message.sessionId);
      return;
    }
    // The server's semantic classification improved after it last served tokens (its project or a
    // standalone file's virtual project finished loading): recompute and repaint.
    // A batch of the server's diagnostics for the whole workspace, files not open included (#1144).
    if (message.method === WORKSPACE_DIAGNOSTICS_METHOD) {
      this.ingestWorkspaceDiagnostics(message.sessionId, message.params);
      return;
    }
    if (message.method === 'workspace/semanticTokens/refresh') {
      this.scheduleRecolor(message.sessionId);
      return;
    }
    // A loading server (Roslyn restoring a solution, jdtls importing a build) reports what it is doing
    // through work-done progress. Surfacing it is what makes a long start read as "loading X" rather
    // than an inert spinner that might as well be a hang.
    if (message.method === '$/progress') {
      this.onProgress(message.sessionId, message.params);
      return;
    }
    // Route the server's own logs into a per-server Output channel (created lazily on first log, so a
    // silent server adds no channel). Not revealed — logs must not steal the panel from a running build.
    if (message.method === 'window/logMessage' || message.method === 'window/showMessage') {
      this.appendServerLog(message.sessionId, message.params);
      if (message.method === 'window/logMessage') {
        this.noteUnrestoredProject(message.sessionId, message.params);
      }
      if (message.method === 'window/showMessage') {
        this.raiseServerProblem(message.sessionId, message.params);
      }
      return;
    }
    // Roslyn says what the user must see (a project that failed to load or restore) through a toast
    // of its own rather than `window/showMessage` (#1134).
    if (message.method === 'window/_roslyn_showToast') {
      this.appendServerLog(message.sessionId, message.params);
      this.raiseServerProblem(message.sessionId, message.params);
      return;
    }
    if (message.method !== 'textDocument/publishDiagnostics') {
      return;
    }
    const params: PublishDiagnosticsParams = message.params as PublishDiagnosticsParams;
    const key: string = normalise(uriToPath(params.uri));
    const tracked: TrackedDocument | undefined = this.tracked.get(key);
    if (tracked === undefined) {
      return;
    }
    this.ingestDiagnostics(tracked, params.diagnostics);
    // Diagnostics arriving mean the server has finished loading the workspace and analysed the
    // document: flip the indicator from starting to ready and re-request semantic tokens — but only
    // on the transition. A loading server (Roslyn analysing a solution) streams diagnostics for many
    // files; refreshing on every push would fan token requests out continuously.
    this.markReady(message.sessionId);
  }

  /**
   * Folds a `$/progress` notification into the session's status row. Each work-done token keeps its
   * `begin` title so later `report`s (which carry only a message or percentage) still read as "what";
   * the row shows the most recently reported token, and clears once every token has ended.
   * @param sessionId The session the progress belongs to.
   * @param params The notification parameters (`token` and `value`).
   */
  private onProgress(sessionId: string, params: unknown): void {
    const candidate: {
      token?: unknown;
      value?: { kind?: unknown; title?: unknown; message?: unknown; percentage?: unknown };
    } | null = (params as typeof candidate) ?? null;
    if (
      candidate === null ||
      (typeof candidate.token !== 'string' && typeof candidate.token !== 'number') ||
      typeof candidate.value !== 'object' ||
      candidate.value === null
    ) {
      return;
    }
    const tokens: Map<string, string> =
      this.progressTitles.get(sessionId) ?? new Map<string, string>();
    this.progressTitles.set(sessionId, tokens);
    const token: string = String(candidate.token);
    const value: { kind?: unknown; title?: unknown; message?: unknown; percentage?: unknown } =
      candidate.value;
    if (value.kind === 'end') {
      tokens.delete(token);
      this.status.setProgress(
        sessionId,
        tokens.size === 0 ? null : [...tokens.values()][tokens.size - 1],
      );
      return;
    }
    if (value.kind === 'begin' && typeof value.title === 'string') {
      tokens.set(token, value.title);
    }
    const title: string | undefined = tokens.get(token);
    if (title === undefined) {
      return;
    }
    const parts: string[] = [title];
    // A request's partial results arrive on its token as an array (a restore Studio asked for, #1143,
    // reports each step that way): the latest entry says what is happening.
    const message: unknown = Array.isArray(candidate.value)
      ? (candidate.value.at(-1) as { message?: unknown } | undefined)?.message
      : value.message;
    if (typeof message === 'string' && message.length > 0) {
      parts.push(message);
    }
    if (typeof value.percentage === 'number') {
      parts.push(`${Math.round(value.percentage)}%`);
    }
    this.status.setProgress(sessionId, parts.join(' — '));
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
    const modelUri: string | undefined = this.editors.modelUriForPath(uriToPath(tracked.uri));
    if (modelUri === undefined) {
      return;
    }
    const model: MonacoApi.editor.ITextModel | null = monaco.editor.getModel(
      monaco.Uri.parse(modelUri),
    );
    if (model === null) {
      return;
    }
    const markers: MonacoApi.editor.IMarkerData[] = toMarkerData(monaco, diagnostics);
    monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, markers);
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
    if (exit.restarted === true) {
      // A deliberate restart, with a fresh server already running under the same id: not a crash, so
      // no backoff bookkeeping — just forget the old session's negotiated state and re-open every
      // document against the new one (which re-attaches this client to it).
      this.log.info('LspClient', 'Server restarted; re-opening its documents', exit.sessionId);
      this.legends.delete(exit.sessionId);
      this.pullCapable.delete(exit.sessionId);
      this.settledSessions.delete(exit.sessionId);
      this.clearPostLoadPulls(exit.sessionId);
      this.status.setState(exit.sessionId, 'starting');
      for (const tracked of this.tracked.values()) {
        if (`${tracked.rootPath}::${tracked.serverId}` === exit.sessionId) {
          tracked.opened = false;
        }
      }
      void this.reattach(exit.sessionId);
      return;
    }
    // Remember the crash (cumulatively — no rolling window a slow crash cycle could slip through),
    // so restarts back off exponentially and eventually stop instead of respawning forever.
    const crash: { count: number; lastAt: number } | undefined = this.crashes.get(exit.sessionId);
    this.crashes.set(exit.sessionId, { count: (crash?.count ?? 0) + 1, lastAt: Date.now() });
    this.log.warn(
      'LspClient',
      `Server session exited unexpectedly (crash #${(crash?.count ?? 0) + 1})`,
      exit.sessionId,
    );
    this.legends.delete(exit.sessionId);
    // Keep the crashed server listed as unavailable — with its restart affordance — rather than
    // removing it from the status strip. Removing it made the whole status-strip control vanish (its
    // trigger is mounted only while a server is listed for the workspace), stranding the user with no
    // way to bring the server back until an incidental document sync happened to re-register it. A
    // later sync still auto-restarts it (startSession re-registers it in the starting state); until
    // then the row's Restart button lets the user recover it by hand.
    // The server's own last words, when it left any, are the one thing that tells a protocol error
    // from a deliberate stop — say them, rather than only that it stopped.
    this.status.setState(
      exit.sessionId,
      'unavailable',
      exit.reason === undefined
        ? 'The server stopped unexpectedly. Restart it to try again.'
        : `The server stopped unexpectedly: ${exit.reason} Restart it to try again.`,
    );
    // The restarted server loads from scratch, so its tokens are degraded again until it re-settles.
    this.settledSessions.delete(exit.sessionId);
    this.clearPostLoadPulls(exit.sessionId);
    const recolorTimer: ReturnType<typeof setTimeout> | undefined = this.recolorTimers.get(
      exit.sessionId,
    );
    if (recolorTimer !== undefined) {
      clearTimeout(recolorTimer);
      this.recolorTimers.delete(exit.sessionId);
    }
    for (const tracked of this.tracked.values()) {
      if (`${tracked.rootPath}::${tracked.serverId}` === exit.sessionId) {
        tracked.opened = false;
      }
    }
  }

  /**
   * Applies a server's own edit (#1015) — a code action's, a command's — for one of this client's
   * sessions, through the same applier a rename uses: open files in their editors, undoable and left
   * unsaved, closed files on disk, confined to the workspace. The server is told whether all of it
   * was applied and, when not, what was skipped and why. A session another client owns is left to it.
   * @param request The server's edit, from the main process.
   */
  private async onApplyEdit(request: LspApplyEditRequest): Promise<void> {
    if (!this.ownsSession(request.sessionId)) {
      return;
    }
    this.log.info('LspClient', 'Applying a server edit', request.label ?? '');
    let reply: LspApplyEditReply;
    try {
      const outcome: WorkspaceEditOutcome = await this.applier.apply(
        fromLspWorkspaceEdit(request.edit, uriToPath),
        this.monaco.getMonaco(),
      );
      reply =
        outcome.skipped.length === 0
          ? { requestId: request.requestId, applied: true }
          : {
              requestId: request.requestId,
              applied: false,
              failureReason: outcome.skipped
                .map((skipped: SkippedEdit): string => `${skipped.path}: ${skipped.reason}`)
                .join('\n'),
            };
    } catch (error: unknown) {
      this.log.error('LspClient', 'A server edit could not be applied', error);
      reply = { requestId: request.requestId, applied: false, failureReason: String(error) };
    }
    this.bridge?.send(LspChannel.ApplyEditReply, reply);
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
   * Appends a server's log message (`window/logMessage`/`window/showMessage`) to its Output channel,
   * labelled by the server identifier. The channel is created on first use, so a server that never logs
   * adds no channel.
   * @param sessionId The session the message belongs to.
   * @param params The notification parameters, whose `message` field carries the log text.
   */
  private appendServerLog(sessionId: string, params: unknown): void {
    const serverId: string | undefined = this.sessionInfo.get(sessionId)?.serverId;
    if (serverId === undefined) {
      return;
    }
    const message: unknown = (params as { message?: unknown } | undefined)?.message;
    if (typeof message !== 'string' || message.length === 0) {
      return;
    }
    this.output.channel(`lsp:${serverId}`, `LSP: ${serverId}`).appendLine(message);
  }

  /**
   * Notes a project the server could not resolve the packages of, when the user has asked to be asked
   * before restoring (#1143): Roslyn then restores nothing and says only, in a warning, that a project
   * "has unresolved dependencies". The projects a load reports together are gathered into one toast
   * offering to restore them.
   * @param sessionId The session the log line came from.
   * @param params The log message.
   */
  private noteUnrestoredProject(sessionId: string, params: unknown): void {
    const serverId: string | undefined = this.sessionInfo.get(sessionId)?.serverId;
    if (
      serverId === undefined ||
      this.lspSettings.serverSetting(serverId, AUTOMATIC_RESTORE_SECTION) !== false
    ) {
      return;
    }
    const text: unknown = (params as { message?: unknown } | null)?.message;
    const project: string | undefined =
      typeof text === 'string' ? UNRESOLVED_PROJECT.exec(text)?.[1] : undefined;
    if (project === undefined) {
      return;
    }
    const projects: Set<string> = this.unrestored.get(sessionId) ?? new Set<string>();
    projects.add(project);
    this.unrestored.set(sessionId, projects);
    clearTimeout(this.unrestoredTimers.get(sessionId));
    this.unrestoredTimers.set(
      sessionId,
      setTimeout((): void => this.offerRestore(sessionId, serverId), UNRESTORED_GATHER_MS),
    );
  }

  /**
   * Offers to restore the projects gathered for a session, in one toast.
   * @param sessionId The session.
   * @param serverId Its server.
   */
  private offerRestore(sessionId: string, serverId: string): void {
    this.unrestoredTimers.delete(sessionId);
    const projects: readonly string[] = [...(this.unrestored.get(sessionId) ?? [])];
    this.unrestored.delete(sessionId);
    if (projects.length === 0) {
      return;
    }
    const first: string = projects[0].split(/[\\/]/).pop() ?? projects[0];
    this.notifications.notify({
      severity: 'warning',
      title:
        projects.length === 1
          ? `${first} needs its packages restored`
          : `${projects.length} projects need their packages restored`,
      detail: this.lspSettings.displayNameOf(serverId) ?? serverId,
      actions: [
        {
          label: 'Restore',
          run: (): void => void this.restoreProjects(sessionId, serverId, projects),
        },
      ],
      key: `lsp-restore:${sessionId}`,
      sticky: true,
    });
  }

  /**
   * Asks a session's server to restore projects' packages (#1143); its progress shows in the server's
   * status row, and a failure is raised with the server's log a click away.
   * @param sessionId The session.
   * @param serverId Its server.
   * @param projects The project files to restore.
   * @returns Returns a promise that resolves once the server has answered.
   */
  private async restoreProjects(
    sessionId: string,
    serverId: string,
    projects: readonly string[],
  ): Promise<void> {
    this.log.info('LspClient', `Restoring ${projects.length} project(s)`, sessionId);
    // The server reports a restore it was asked for as partial results on this token, which the
    // server's status row shows as it does the server's own progress.
    const token: string = `studio-restore-${++this.restores}`;
    const tokens: Map<string, string> =
      this.progressTitles.get(sessionId) ?? new Map<string, string>();
    tokens.set(token, 'Restore');
    this.progressTitles.set(sessionId, tokens);
    this.status.setProgress(sessionId, 'Restore');
    let result: unknown;
    try {
      result = await this.bridge?.invoke(LspChannel.Request, sessionId, RESTORE_METHOD, {
        projectFilePaths: projects,
        partialResultToken: token,
      });
    } catch {
      result = null;
    }
    this.onProgress(sessionId, { token, value: { kind: 'end' } });
    if ((result as { success?: unknown } | null)?.success === true) {
      return;
    }
    this.notifications.notify({
      severity: 'error',
      title: 'Restoring packages failed',
      detail: this.lspSettings.displayNameOf(serverId) ?? serverId,
      actions: [{ label: 'Show log', run: (): void => this.output.show(`lsp:${serverId}`) }],
      key: `lsp-restore:${sessionId}`,
    });
  }

  /**
   * Raises a server's error or warning for the user as a toast (#1134), with "Show log" opening its
   * Output channel. One toast per session: a burst (a solution whose projects fail to load one after
   * another) updates the toast with a count rather than stacking a toast per project. Information and
   * log-level messages stay in the Output channel only.
   * @param sessionId The session the message came from.
   * @param params The message: `{ type, message }` for `window/showMessage`, `{ messageType, message }`
   * for Roslyn's toast.
   */
  private raiseServerProblem(sessionId: string, params: unknown): void {
    const serverId: string | undefined = this.sessionInfo.get(sessionId)?.serverId;
    const candidate: { type?: unknown; messageType?: unknown; message?: unknown } | null =
      (params as typeof candidate) ?? null;
    const type: unknown = candidate?.type ?? candidate?.messageType;
    const text: unknown = candidate?.message;
    if (serverId === undefined || (type !== 1 && type !== 2) || typeof text !== 'string') {
      return;
    }
    const message: string = text.replace(/\s*See (the )?logs? for details\.?\s*$/i, '').trim();
    if (message.length === 0) {
      return;
    }
    // Roslyn reports one failed project more than once; a repeat is the same problem, not another.
    const now: number = Date.now();
    const previous: { messages: ReadonlySet<string>; at: number } | undefined =
      this.serverProblems.get(sessionId);
    const messages: Set<string> = new Set<string>(
      previous !== undefined && now - previous.at < SERVER_PROBLEM_BURST_MS
        ? previous.messages
        : [],
    );
    messages.add(message);
    this.serverProblems.set(sessionId, { messages, at: now });
    const count: number = messages.size;
    const server: string = this.lspSettings.displayNameOf(serverId) ?? serverId;
    this.notifications.notify({
      severity: type === 1 ? 'error' : 'warning',
      title: count === 1 ? message : `${server} reported ${count} problems`,
      detail: count === 1 ? server : `Latest: ${message}`,
      actions: [{ label: 'Show log', run: (): void => this.output.show(`lsp:${serverId}`) }],
      key: `lsp-problem:${sessionId}`,
    });
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
    // A file's workspace report stands in for it only while it is not open: an open document's own
    // pull is fresher (it sees unsaved edits). A session no longer running reports nothing.
    for (const [sessionId, files] of this.workspaceDiagnostics) {
      if (!this.sessionInfo.has(sessionId)) {
        continue;
      }
      for (const [key, diagnostics] of files) {
        if (!this.tracked.has(key)) {
          merged.push(...diagnostics);
        }
      }
    }
    this.emit(merged);
  }

  /**
   * Takes a batch of a server's diagnostics for the whole workspace (#1144): each file's full report
   * replaces what it had (an empty one clears it), and an unchanged report keeps it. They reach the
   * Error List as workspace diagnostics, located by path, so a file that is not open still lists its
   * errors and opens at them.
   * @param sessionId The session the reports came from.
   * @param params The batch: `{ reports }`, with `reset` when the pull is starting over.
   */
  private ingestWorkspaceDiagnostics(sessionId: string, params: unknown): void {
    const batch: { reports?: unknown; reset?: unknown } | null = (params as typeof batch) ?? null;
    const reports: unknown = batch?.reports;
    if (!Array.isArray(reports)) {
      return;
    }
    const files: Map<string, readonly Diagnostic[]> =
      this.workspaceDiagnostics.get(sessionId) ?? new Map<string, readonly Diagnostic[]>();
    this.workspaceDiagnostics.set(sessionId, files);
    // The pull is starting over: what it reported before is dropped, and reported again if it holds.
    let changed: boolean = batch?.reset === true && files.size > 0;
    if (batch?.reset === true) {
      files.clear();
    }
    for (const report of reports as readonly {
      uri?: unknown;
      kind?: unknown;
      items?: unknown;
    }[]) {
      if (typeof report.uri !== 'string' || report.kind !== 'full') {
        continue;
      }
      const uri: string = report.uri;
      const key: string = normalise(uriToPath(uri));
      const items: readonly LspDiagnostic[] = Array.isArray(report.items)
        ? (report.items as readonly LspDiagnostic[])
        : [];
      if (items.length === 0) {
        changed = files.delete(key) || changed;
        continue;
      }
      files.set(
        key,
        items.map((diagnostic: LspDiagnostic): Diagnostic => ({
          ...toDiagnostic(diagnostic, { uri, documentId: null }),
          scope: 'workspace',
        })),
      );
      changed = true;
    }
    if (changed) {
      this.publish();
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
      // A language server's decompiled source (#1133) lives in the temporary directory, outside the
      // workspace, but belongs to the workspace's session: the server generated it for a symbol the
      // workspace references, and answers hover and Go to Definition inside it only when it is opened
      // against that session. (The main process decides which such files may be opened at all.)
      if (isWithin(filePath, listing.path) || isMetadataAsSource(filePath)) {
        return { root: listing.path, standalone: false };
      }
      return null;
    }
    return { root: parentDir(filePath), standalone: true };
  }
}
