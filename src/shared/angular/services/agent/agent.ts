import {
  computed,
  DestroyRef,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type {
  AgentContextRef,
  AgentMode,
  AgentSurface,
  AiEditDecision,
  AiEffort,
  AiEvent,
  AiSlashCommand,
  AiImageRef,
  AiInputChoice,
  AiModelInfo,
  AiPermissionRemember,
  AiProviderId,
  AiProviderInfo,
  AiRemoteControlMode,
  AiRunState,
  AiTaskProgressEvent,
  AiTaskStartedEvent,
  AiTaskUpdatedEvent,
} from '@shared/api/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { AgentEngine } from '../agent-engine/agent-engine';
import { Log } from '@shared/angular/services/log/log';
import { AgentPerf } from '@shared/angular/services/agent-perf/agent-perf';
import {
  NotificationAction,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { AGENT_WORKSPACE_ROOT } from './agent-workspace-root';
import { isNotLoggedInReply, looksLikeAuthFailure } from './auth-failure';

/**
 * How long, in milliseconds, streamed text deltas are buffered before they are folded into the
 * transcript — roughly one frame, so a stream repaints at display cadence instead of once per token.
 */
const STREAM_FLUSH_MS: number = 16;

/**
 * Identifies the kind of transcript item.
 */
export type AgentItemKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'permission'
  | 'input-request'
  | 'edit-decision'
  | 'error';

/**
 * Identifies the lifecycle state of a tool item.
 */
export type AgentToolState = 'running' | 'backgrounded' | 'ok' | 'error';

/**
 * A task the agent has started and not yet seen settle — a `run_in_background` command, a subagent, or
 * a local workflow. Live-session state: the registry is rebuilt from the provider's events and never
 * persisted, because a task belongs to the harness session rather than to the transcript.
 */
export interface AgentTask {
  /**
   * Gets the provider's identifier for the task, the key every later event for it carries.
   */
  readonly taskId: string;

  /**
   * Gets the `toolId` of the tool use that launched the task, when one did, joining the task to its
   * tool card in the transcript.
   */
  readonly toolId?: string;

  /**
   * Gets the latest description of what the task is doing, refreshed as progress arrives.
   */
  readonly description: string;

  /**
   * Gets the subagent type, when the task is a Task-tool subagent.
   */
  readonly agentType?: string;

  /**
   * Gets the workflow's name, when the task is a local workflow.
   */
  readonly workflowName?: string;

  /**
   * Gets the name of the last tool the task ran, when it has reported one.
   */
  readonly lastToolName?: string;

  /**
   * Gets the task's running total of tokens consumed.
   */
  readonly tokens: number;

  /**
   * Gets the task's running count of tool uses.
   */
  readonly toolUses: number;

  /**
   * Gets how long the task has been running, in milliseconds, as last reported.
   */
  readonly durationMs: number;

  /**
   * Gets the task's lifecycle state as last patched by the provider.
   */
  readonly status: 'pending' | 'running' | 'paused';

  /**
   * Gets whether the task has been moved to the background.
   */
  readonly backgrounded: boolean;

  /**
   * Gets whether the task is ambient housekeeping the transcript hides. It stays in the registry so a
   * tasks surface can list it, but raises no inline note.
   */
  readonly skipTranscript: boolean;
}

/**
 * Identifies the state of a permission request item.
 */
export type AgentPermissionState = 'pending' | 'allowed' | 'denied' | 'dismissed';

/**
 * Identifies the state of an input-request (agent question) item: awaiting the user's answer,
 * answered, or dismissed (the user skipped it, or the run ended before an answer).
 */
export type AgentInputState = 'pending' | 'answered' | 'dismissed';

/**
 * Identifies the state of an edit-decision (staged edit preview) item: awaiting the user's decision,
 * applied, rejected, or dismissed (the run ended before a decision).
 */
export type AgentEditDecisionState = 'pending' | 'applied' | 'rejected' | 'dismissed';

/**
 * A single item in the agent transcript. The fields used depend on {@link kind}: user/assistant/
 * thinking carry {@link text}; tool carries the tool fields; permission carries the permission fields.
 */
export interface AgentItem {
  /**
   * Gets the unique identifier of the item.
   */
  readonly id: string;

  /**
   * Gets the item kind.
   */
  readonly kind: AgentItemKind;

  /**
   * Gets the text content (user/assistant/thinking items).
   */
  readonly text: string;

  /**
   * Gets whether the item is closed to continuation, so streamed text never folds into it. Set on
   * out-of-band notes the agent did not stream — a background-task settle, for instance — which are
   * complete sentences in their own right and must not absorb whatever the agent says next.
   */
  readonly sealed?: boolean;

  /**
   * Gets the images attached to a user message (pasted or dropped into the composer), rendered as
   * thumbnails and persisted with the transcript.
   */
  readonly images?: readonly AiImageRef[];

  /**
   * Gets the correlation id of a tool use.
   */
  readonly toolId?: string;

  /**
   * Gets the tool's display name.
   */
  readonly toolName?: string;

  /**
   * Gets a one-line summary of the tool input.
   */
  readonly toolDetail?: string;

  /**
   * Gets the tool's lifecycle state.
   */
  readonly toolState?: AgentToolState;

  /**
   * Gets the tool's full input, pretty-printed, for the expanded raw-detail view (clamped at the
   * source when enormous).
   */
  readonly toolInput?: string;

  /**
   * Gets the tool's raw output — or its error detail when it failed — for the expanded raw-detail
   * view (clamped at the source when enormous).
   */
  readonly toolOutput?: string;

  /**
   * Gets the id used to answer a permission request.
   */
  readonly permissionId?: string;

  /**
   * Gets the display name of the tool requesting permission.
   */
  readonly permissionName?: string;

  /**
   * Gets a one-line summary of what the gated tool will do.
   */
  readonly permissionDetail?: string;

  /**
   * Gets the permission request's state.
   */
  readonly permissionState?: AgentPermissionState;

  /**
   * Gets a value indicating whether the asking run is workspace-scoped, so the prompt can offer a
   * workspace-remember option.
   */
  readonly permissionHasWorkspace?: boolean;

  /**
   * Gets how long the broker remembers the grant (granted permission items only; undefined for a
   * one-off grant).
   */
  readonly permissionRemember?: AiPermissionRemember;

  /**
   * Gets the id used to answer an input request (an agent question).
   */
  readonly inputId?: string;

  /**
   * Gets the question the agent is asking.
   */
  readonly inputQuestion?: string;

  /**
   * Gets the suggested answers the user can pick from (empty for a free-form question).
   */
  readonly inputChoices?: readonly AiInputChoice[];

  /**
   * Gets the input request's state.
   */
  readonly inputState?: AgentInputState;

  /**
   * Gets the answer the user gave (answered input requests only).
   */
  readonly inputAnswer?: string;

  /**
   * Gets the id used to answer an edit-decision request (a staged edit preview).
   */
  readonly decisionId?: string;

  /**
   * Gets the display name of the document a staged edit targets.
   */
  readonly decisionName?: string;

  /**
   * Gets the one-line summary of a staged edit.
   */
  readonly decisionDetail?: string;

  /**
   * Gets the edit decision's state.
   */
  readonly decisionState?: AgentEditDecisionState;

  /**
   * Gets a value indicating whether the staged change is showing as a diff in the document well.
   */
  readonly decisionHasDiff?: boolean;

  /**
   * Gets a value indicating whether the grant also turned on auto-accepting edits for the session
   * (applied edit decisions only).
   */
  readonly decisionAuto?: boolean;

  /**
   * Gets the full failure detail of an error item (the raw provider error), shown in its expandable
   * diagnostics; undefined when the cause line already carries everything.
   */
  readonly errorDetail?: string;

  /**
   * Gets the provider/model readout of an error item (what the failed run was going through).
   */
  readonly errorProvider?: string;

  /**
   * Gets the failed-tool context of an error item (the failing tool's name and its error output),
   * when a tool failure preceded the run's end.
   */
  readonly errorToolContext?: string;

  /**
   * Gets the prompt of the turn that failed, enabling the error item's one-click retry; undefined
   * when the failed turn's prompt is unknown (no retry is offered).
   */
  readonly errorPrompt?: string;

  /**
   * Gets the images the failed turn carried, so its retry resends them with the prompt.
   */
  readonly errorImages?: readonly AiImageRef[];

  /**
   * Gets the context the failed turn carried, so its retry resends it. Held on the item because the
   * turn consumed the conversation's attachments when it started.
   */
  readonly errorContext?: readonly AgentContextRef[];

  /**
   * Gets a value indicating whether the error item's turn has been retried (the retry affordance is
   * spent).
   */
  readonly errorRetried?: boolean;

  /**
   * Gets the provider's identifier for an assistant item's message (the Claude SDK message uuid),
   * anchoring conversation branching: a rewind forks the session resumed up to the last anchored
   * assistant item it keeps. Absent for providers without sessions.
   */
  readonly providerMessageId?: string;

  /**
   * Gets the identifier of the sub-agent this item belongs to — the {@link toolId} of the Task tool
   * item that spawned it — so it renders nested under that lane. Absent for top-level items.
   */
  readonly parentToolId?: string;

  /**
   * Gets the type of the sub-agent a Task tool item spawns (e.g. `Explore`), labelling its lane.
   */
  readonly agentType?: string;

  /**
   * Gets the tokens a sub-agent has consumed so far (input plus output, accumulated across its
   * turns), shown on its lane's status line. Task tool items only.
   */
  readonly agentTokens?: number;
}

/**
 * A conversation branch point: bumped each time the user rewinds (edit-and-resend or retry), carrying
 * the full original transcript so the hosting conversation can preserve the original line as its own
 * reachable record before the edited line continues under a new one.
 */
export interface AgentBranchPoint {
  /**
   * Gets the branch counter (0 before any branch).
   */
  readonly epoch: number;

  /**
   * Gets the full transcript as it stood before the rewind (empty before any branch).
   */
  readonly origin: readonly AgentItem[];

  /**
   * Gets the provider session the original line was on, so its record stays resumable.
   */
  readonly originSessionId: string | null;
}

/**
 * A message the user sent while a run was executing, waiting to dispatch: it is sent automatically
 * when the run completes, and can be edited or removed before then.
 */
export interface AgentQueuedMessage {
  /**
   * Gets the entry's unique identifier.
   */
  readonly id: string;

  /**
   * Gets the queued message text.
   */
  readonly text: string;

  /**
   * Gets the owning tab captured when the message was queued (as for `send`), or undefined to fall
   * back to the last turn's tab when dispatched.
   */
  readonly owningTabId?: string;

  /**
   * Gets the surface captured when the message was queued, or undefined to fall back to the last
   * turn's surface when dispatched.
   */
  readonly surface?: AgentSurface;

  /**
   * Gets the images attached to the queued message, sent with it when it dispatches. Not persisted
   * with the conversation (a restored queue is text-only).
   */
  readonly images?: readonly AiImageRef[];
}

/**
 * Owns a single agent conversation: it drives runs through the {@link AiRuntime} and folds the
 * streamed provider-agnostic events into a structured transcript (text, reasoning, tool activity,
 * inline permission prompts). State is exposed as signals so the hosting view renders the
 * conversation. The provider/model the run goes through is the global selection owned by
 * {@link AgentEngine}.
 *
 * This service is per-conversation, not a singleton: it is provided at the {@link AgentChat}
 * component level so every agent tab and the dockable agent panel each get their own transcript.
 */
@Service({ autoProvided: false })
export class Agent {
  /**
   * Holds the agent runtime the conversation runs through.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the global engine: the registered providers and the app-wide default selection this
   * conversation falls back to until it picks its own provider/model.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Holds this conversation's own connection choice, or null to follow the global default. Set per
   * conversation so each agent can run through a different connection.
   */
  private readonly providerOverride: WritableSignal<AiProviderId | null> =
    signal<AiProviderId | null>(null);

  /**
   * Holds this conversation's own model choice, or null to follow the effective provider's default.
   */
  private readonly modelOverride: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the connection this conversation's runs go through: its own choice, or the global default.
   */
  public readonly provider: Signal<AiProviderId> = computed(
    (): AiProviderId => this.providerOverride() ?? this.engine.provider(),
  );

  /**
   * Gets the descriptor of this conversation's effective provider, or undefined before providers load.
   */
  private readonly providerInfo: Signal<AiProviderInfo | undefined> = computed(
    (): AiProviderInfo | undefined =>
      this.engine.providers().find((info: AiProviderInfo): boolean => info.id === this.provider()),
  );

  /**
   * Gets the models offered by this conversation's effective provider, in display order.
   */
  public readonly models: Signal<readonly AiModelInfo[]> = computed(
    (): readonly AiModelInfo[] => this.providerInfo()?.models ?? [],
  );

  /**
   * Gets the model this conversation's runs go through: its own valid choice, else — when it follows
   * the global connection — the global model, else the effective provider's default.
   */
  public readonly model: Signal<string> = computed((): string => {
    const chosen: string | null = this.modelOverride();
    const models: readonly AiModelInfo[] = this.models();
    if (
      chosen !== null &&
      models.some((candidate: AiModelInfo): boolean => candidate.id === chosen)
    ) {
      return chosen;
    }
    if (this.providerOverride() === null) {
      return this.engine.model();
    }
    return this.providerInfo()?.defaultModelId ?? '';
  });

  /**
   * Selects the connection this conversation's runs go through, resetting its model to that
   * connection's default. Choosing the global connection clears the override so the conversation
   * resumes following the global default.
   * @param id The connection id.
   */
  public setProvider(id: AiProviderId): void {
    this.providerOverride.set(id === this.engine.provider() ? null : id);
    this.modelOverride.set(null);
    this.logger.info('Agent', `Conversation connection selected '${id}'`);
  }

  /**
   * Selects the model this conversation's runs go through.
   * @param id The model id.
   */
  public setModel(id: string): void {
    this.modelOverride.set(id);
    this.logger.info('Agent', `Conversation model chosen '${id}'`);
  }

  /**
   * Holds the workspace, used to scope runs to the open folder.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds a host-provided override for the run's workspace root, or null when the host relies on the
   * global {@link Workspace}. The repository tab provides one returning its bound repository's root.
   */
  private readonly workspaceRootResolver: (() => string | null) | null = inject(
    AGENT_WORKSPACE_ROOT,
    { optional: true },
  );

  /**
   * Holds the settings service, the source of the run's permission posture and token cap.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the application-wide notification store terminal run states are raised to, so a run that
   * ends in a background tab surfaces as a toast (and one the user is watching is still recorded).
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the tab registry, consulted for the owning tab's title and active state when a run ends,
   * and driven by a completion toast's Show action.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the destroy notifier used to unsubscribe this conversation from runtime events.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds the structured logger.
   */
  private readonly logger: Log = inject(Log);

  /**
   * Holds the transcript-performance probe (GitHub #408 instrumentation), notified each time the stream
   * buffer folds into the transcript.
   */
  private readonly perf: AgentPerf = inject(AgentPerf);

  /**
   * Holds the ordered transcript.
   */
  private readonly log: WritableSignal<readonly AgentItem[]> = signal<readonly AgentItem[]>([]);

  /**
   * Holds a value indicating whether a run is in flight.
   */
  private readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the "not signed in to Claude" prompt is pending. Raised when a run through the Claude
   * local-login connection fails and an authoritative check ({@link AiRuntime.checkClaudeAuth}) finds the
   * login expired or absent; the host shows the login modal, and dismissing it or a successful sign-in
   * clears it.
   */
  private readonly needsLoginState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the "not signed in to Claude" prompt is pending.
   */
  public readonly needsLogin: Signal<boolean> = this.needsLoginState.asReadonly();

  /**
   * Holds how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   * The user's choice persists across new chats within this session.
   */
  private readonly modeState: WritableSignal<AgentMode> = signal<AgentMode>('agent');

  /**
   * Holds the reasoning-effort level the conversation's runs use (#330), or null for the provider
   * default. Set via `/effort`; persists across new chats within this session; ignored by providers
   * that do not offer it.
   */
  private readonly effortState: WritableSignal<AiEffort | null> = signal<AiEffort | null>(null);

  /**
   * Holds whether this conversation's session is exposed via the provider's Remote Control feature
   * (#331). Just on or off: HOW MUCH a peer may do once exposed is the user's global Remote control
   * posture, not a per-agent choice. Persists across new chats within this session; ignored by
   * providers that do not support it.
   */
  private readonly remoteControlState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the slash commands the live provider has discovered for this conversation (#330), or empty
   * before any are reported / for a provider that reports none. Refreshed when the provider pushes a
   * change; the composer merges them into its `/` menu.
   */
  private readonly discoveredCommandsState: WritableSignal<readonly AiSlashCommand[]> = signal<
    readonly AiSlashCommand[]
  >([]);

  /**
   * Holds the files and folders attached to the conversation's context, passed to each run so the agent
   * can read them with its own file tools. Cleared when the conversation is cleared or restored.
   */
  private readonly contextPathsState: WritableSignal<readonly AgentContextRef[]> = signal<
    readonly AgentContextRef[]
  >([]);

  /**
   * Holds the identifier of the in-flight run, or null when none.
   */
  private activeRequestId: string | null = null;

  /**
   * Holds the prompt of the most recently started turn, attached to an error item when a run fails
   * so its one-click retry can re-run the turn. Null until the first send of this session.
   */
  private lastPrompt: string | null = null;

  /**
   * Holds the images of the most recently started turn, so an error item's retry resends them.
   */
  private lastImages: readonly AiImageRef[] = [];

  /**
   * Holds the attached context of the most recently started turn, so an error item's retry resends it.
   * A turn consumes what was attached, so without this a retry would run stripped of the very files
   * and selections the failed turn was given.
   */
  private lastContext: readonly AgentContextRef[] = [];

  /**
   * Holds the owning tab of the most recently started turn, the fallback for dispatching a queued
   * message that captured none (a restored queue).
   */
  private lastOwningTabId: string | undefined = undefined;

  /**
   * Holds the surface of the most recently started turn, the fallback for dispatching a queued
   * message that captured none (a restored queue).
   */
  private lastSurface: AgentSurface | undefined = undefined;

  /**
   * Holds whether a successful sign-in should re-run the last turn: true when the prompt was raised by a
   * turn that failed for want of a login (so the user gets their answer without re-typing), false when
   * the user opened it themselves via `/login` (nothing to re-run).
   */
  private retryAfterLogin: boolean = false;

  /**
   * Holds the messages waiting to dispatch once the running turn completes.
   */
  private readonly queueState: WritableSignal<readonly AgentQueuedMessage[]> = signal<
    readonly AgentQueuedMessage[]
  >([]);

  /**
   * Holds the latest branch point (see {@link AgentBranchPoint}).
   */
  private readonly branchState: WritableSignal<AgentBranchPoint> = signal<AgentBranchPoint>({
    epoch: 0,
    origin: [],
    originSessionId: null,
  });

  /**
   * Holds the branch anchor the next run forks the resumed session at, or null for an ordinary run.
   * Set by {@link rewind} and consumed by the next {@link startRun}.
   */
  private forkAt: string | null = null;

  /**
   * Holds the stable id of this conversation's live agent session (#327): a live-harness provider routes
   * turns that share it into one held-open session. Reset — closing the old session — when the
   * conversation identity changes (New chat, restore, fork), and closed when the host is destroyed.
   */
  private agentSessionId: string = crypto.randomUUID();

  /**
   * Tracks the counter that makes queued-message identifiers unique.
   */
  private queueSequence: number = 0;

  /**
   * Holds the provider session this conversation resumes on its next turn, so the model keeps the
   * earlier turns' context. Null for a fresh conversation; set from the first run's `session` event and
   * updated as the session is resumed, reset on {@link clear}, and rehydrated by {@link restore}.
   */
  private readonly sessionIdState: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Tracks the running counter used to generate unique item identifiers.
   */
  private sequence: number = 0;

  /**
   * Holds the streamed text accumulated since the last transcript flush, or null when none is
   * buffered. Folding once per flush window instead of once per token is what keeps a fast stream
   * from starving the renderer.
   */
  private pendingStream: {
    kind: 'assistant' | 'thinking';
    text: string;
    parentToolId?: string;
    messageUuid?: string;
  } | null = null;

  /**
   * Holds the pending stream-flush timer, or null when none is scheduled.
   */
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds a value indicating whether the in-flight run is a compaction run, whose streamed text is
   * buffered into {@link compactionText} and folded into a single summary item rather than appended.
   */
  private compacting: boolean = false;

  /**
   * Accumulates the summary text streamed by a compaction run.
   */
  private compactionText: string = '';

  /**
   * Holds a compaction summary waiting to seed the next turn's fresh session, or null when none is
   * pending. A compaction starts a new provider session (so the context genuinely shrinks rather than
   * the old session refilling the meter on the next turn), which loses the model's memory; this carries
   * the summary into that new session as the next turn's opening context. Consumed once, by the first
   * run after the compaction.
   */
  private pendingContextSeed: string | null = null;

  /**
   * Holds the tokens the conversation currently occupies in the context window: the latest turn's
   * input (the whole re-sent conversation) plus its output. Zero for a fresh conversation and after a
   * compaction, refilling on the next turn.
   */
  private readonly contextTokensState: WritableSignal<number> = signal<number>(0);

  /**
   * Accumulates the conversation's cost in US dollars across its turns, when the provider reports it
   * (the Claude Agent SDK does; the AI-SDK providers do not, leaving this at zero).
   */
  private readonly costUsdState: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the ordered transcript.
   */
  public readonly items: Signal<readonly AgentItem[]> = this.log.asReadonly();

  /**
   * Gets a value indicating whether the transcript holds any items. A memoized boolean, so readers
   * that only care whether the conversation has started (the Mission Control rail's status label, for
   * one) do not re-run on every streaming append the way a raw `items().length` read would — the
   * value is stable across a run once the first item lands.
   */
  public readonly hasMessages: Signal<boolean> = computed((): boolean => this.log().length > 0);

  /**
   * Gets the messages waiting to dispatch once the running turn completes.
   */
  public readonly queued: Signal<readonly AgentQueuedMessage[]> = this.queueState.asReadonly();

  /**
   * Gets the latest branch point, watched by the hosting conversation so a rewind's original line is
   * preserved as its own record.
   */
  public readonly branch: Signal<AgentBranchPoint> = this.branchState.asReadonly();

  /**
   * Gets a value indicating whether a run is in flight.
   */
  public readonly isRunning: Signal<boolean> = this.busy.asReadonly();

  /**
   * Holds the conversation's live tasks, keyed by task id in arrival order.
   */
  private readonly taskState: WritableSignal<readonly AgentTask[]> = signal<readonly AgentTask[]>(
    [],
  );

  /**
   * Gets the tasks the agent has started and not yet seen settle. Live-session state only: never
   * persisted, and rebuilt from the provider's events after a resume.
   */
  public readonly tasks: Signal<readonly AgentTask[]> = this.taskState.asReadonly();

  /**
   * Gets the count of live tasks the transcript does not hide, which is what a status surface counts.
   * Ambient housekeeping tasks stay in {@link tasks} but are deliberately not advertised.
   */
  public readonly visibleTaskCount: Signal<number> = computed(
    (): number =>
      this.taskState().filter((task: AgentTask): boolean => !task.skipTranscript).length,
  );

  /**
   * Gets how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   */
  public readonly mode: Signal<AgentMode> = this.modeState.asReadonly();

  /**
   * Gets the reasoning-effort level the conversation's runs use (#330), or null for the provider default.
   */
  public readonly effort: Signal<AiEffort | null> = this.effortState.asReadonly();

  /**
   * Gets whether this conversation's session is exposed via Remote Control (#331) — the on/off state
   * the agent's own toggle drives.
   */
  public readonly remoteControlEnabled: Signal<boolean> = this.remoteControlState.asReadonly();

  /**
   * Gets the mode this conversation's runs are dispatched with: `off` while the agent is not exposed,
   * and otherwise whatever the user's global Remote control posture says exposure means. Reading the
   * posture here (rather than latching it when the toggle is pressed) means changing it in Settings
   * re-aims every exposed agent, without each having to be toggled off and on again.
   */
  public readonly remoteControl: Signal<AiRemoteControlMode> = computed(
    (): AiRemoteControlMode =>
      this.remoteControlState() ? this.settings.aiRemoteControlPosture() : 'off',
  );

  /**
   * Gets whether the selected provider supports Remote Control, so the UI offers the control only when
   * it would work.
   */
  public readonly supportsRemoteControl: Signal<boolean> = computed(
    (): boolean => this.providerInfo()?.supportsRemoteControl ?? false,
  );

  /**
   * Gets the slash commands the live provider has discovered for this conversation (#330), for the
   * composer's `/` menu. Empty for providers that report none.
   */
  public readonly discoveredCommands: Signal<readonly AiSlashCommand[]> =
    this.discoveredCommandsState.asReadonly();

  /**
   * Gets the files and folders attached to the conversation's context.
   */
  public readonly contextPaths: Signal<readonly AgentContextRef[]> =
    this.contextPathsState.asReadonly();

  /**
   * Gets the estimated tokens the attached context will add to the next turn: the inlined selection
   * text at ~4 characters per token. Files and folders contribute nothing here — what they cost
   * depends on what the agent actually reads, which the next turn's reported usage captures.
   */
  public readonly pendingContextTokens: Signal<number> = computed((): number =>
    Math.ceil(
      this.contextPathsState().reduce(
        (total: number, ref: AgentContextRef): number =>
          total + (ref.kind === 'selection' ? (ref.content?.length ?? 0) : 0),
        0,
      ) / 4,
    ),
  );

  /**
   * Gets the provider session this conversation resumes on its next turn, or null for a fresh
   * conversation. Persisted with the conversation so its memory survives reopening and restart.
   */
  public readonly sessionId: Signal<string | null> = this.sessionIdState.asReadonly();

  /**
   * Gets the tokens the conversation currently occupies in the context window (the latest turn's
   * input plus output). Zero for a fresh conversation and immediately after a compaction.
   */
  public readonly contextTokens: Signal<number> = this.contextTokensState.asReadonly();

  /**
   * Gets the selected model's context window in tokens (the readout's denominator), or zero when it is
   * unknown. Sourced from this conversation's own effective model.
   */
  public readonly contextWindow: Signal<number> = computed((): number => {
    const id: string = this.model();
    return this.models().find((model: AiModelInfo): boolean => model.id === id)?.contextWindow ?? 0;
  });

  /**
   * Gets the conversation's accumulated cost in US dollars, or zero when the provider reports no cost.
   */
  public readonly costUsd: Signal<number> = this.costUsdState.asReadonly();

  /**
   * Gets a value indicating whether the agent is waiting on the user: a permission decision or an
   * answer to a question it asked.
   */
  public readonly awaitingDecision: Signal<boolean> = computed(
    (): boolean =>
      this.log().some(
        (item: AgentItem): boolean =>
          (item.kind === 'permission' && item.permissionState === 'pending') ||
          (item.kind === 'edit-decision' && item.decisionState === 'pending'),
      ) || this.pendingInput() !== undefined,
  );

  /**
   * Gets the question the agent is currently waiting on, or undefined when none is pending. At most
   * one question is pending at a time (the run blocks on the answer), so this is the item the
   * composer's answer mode targets.
   */
  public readonly pendingInput: Signal<AgentItem | undefined> = computed(
    (): AgentItem | undefined =>
      this.log().find(
        (item: AgentItem): boolean =>
          item.kind === 'input-request' && item.inputState === 'pending',
      ),
  );

  /**
   * Initializes a new instance of the {@link Agent} class, subscribing to runtime events for the
   * lifetime of the hosting view.
   */
  public constructor() {
    const unsubscribe: () => void = this.runtime.onEvent((event: AiEvent): void =>
      this.onEvent(event),
    );
    this.destroyRef.onDestroy((): void => {
      unsubscribe();
      // Tie the live session's teardown to the host's lifetime (#327): closing the tab ends its agent's
      // held-open session.
      this.runtime.closeSession(this.agentSessionId);
      this.logger.info('Agent', 'Agent session closed', this.agentSessionId);
    });
  }

  /**
   * Sends a user message. While idle it starts a run; while a run is executing it steers the run with
   * the message where the provider supports it, and otherwise queues the message to dispatch when the
   * run completes. Blank messages are ignored.
   * @param text The user's message.
   * @param owningTabId The identifier of the tab hosting this agent (every host passes its tab id —
   * the content host sets one on each view), so a surface's in-app tools act on that tab; absent only
   * for hosts with no owning tab, such as the Workspace and Repository agent panels, whose editor
   * tools fall back to the focused editor.
   * @param surface What this run acts on, which selects the tool set the providers expose; omitted
   * for the editor surface. The standalone agent tab passes `project`, which exposes no in-app tools.
   * @param images The images attached to the message, sent to the model alongside it.
   */
  public send(
    text: string,
    owningTabId?: string,
    surface?: AgentSurface,
    images: readonly AiImageRef[] = [],
  ): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (this.busy()) {
      void this.deferSend(trimmed, owningTabId, surface, images);
      return;
    }
    this.push({ kind: 'user', text: trimmed, ...(images.length === 0 ? {} : { images }) });
    this.startRun(trimmed, owningTabId, surface, images);
  }

  /**
   * Handles a message sent while a run executes: first tries to steer the in-flight run (accepted
   * only when the provider supports streaming input and the run is still open — the message then
   * becomes a further turn in the same run), otherwise queues it to dispatch when the run completes.
   * A compaction run is never steered, and neither is a message carrying images (the steer channel
   * is text-only) — those queue directly.
   * @param text The trimmed message.
   * @param owningTabId The owning tab (as for {@link send}).
   * @param surface The run surface (as for {@link send}).
   * @param images The images attached to the message.
   */
  private async deferSend(
    text: string,
    owningTabId?: string,
    surface?: AgentSurface,
    images: readonly AiImageRef[] = [],
  ): Promise<void> {
    const requestId: string | null = this.activeRequestId;
    if (
      !this.compacting &&
      images.length === 0 &&
      requestId !== null &&
      (await this.runtime.steer(requestId, text))
    ) {
      this.push({ kind: 'user', text });
      this.lastPrompt = text;
      return;
    }
    this.queueSequence += 1;
    const entry: AgentQueuedMessage = {
      id: `queued-${this.queueSequence}`,
      text,
      ...(owningTabId === undefined ? {} : { owningTabId }),
      ...(surface === undefined ? {} : { surface }),
      ...(images.length === 0 ? {} : { images }),
    };
    this.queueState.update(
      (queue: readonly AgentQueuedMessage[]): readonly AgentQueuedMessage[] => [...queue, entry],
    );
    // The run may have ended while the steer attempt was in flight; drain immediately if now idle.
    if (!this.busy()) {
      this.dispatchQueue();
    }
  }

  /**
   * Removes a queued message before it dispatches.
   * @param id The queued entry's identifier.
   */
  public removeQueued(id: string): void {
    this.queueState.update((queue: readonly AgentQueuedMessage[]): readonly AgentQueuedMessage[] =>
      queue.filter((entry: AgentQueuedMessage): boolean => entry.id !== id),
    );
  }

  /**
   * Removes a queued message and returns its text, so the host can load it back into the composer
   * for editing.
   * @param id The queued entry's identifier.
   * @returns Returns the entry's text, or null when it no longer exists.
   */
  public takeQueued(id: string): string | null {
    const entry: AgentQueuedMessage | undefined = this.queueState().find(
      (candidate: AgentQueuedMessage): boolean => candidate.id === id,
    );
    if (entry === undefined) {
      return null;
    }
    this.removeQueued(id);
    return entry.text;
  }

  /**
   * Dispatches the next queued message as a normal turn. No-ops while a run is executing or when the
   * queue is empty; each completed run dispatches the next entry, so a backlog drains one turn at a
   * time.
   */
  private dispatchQueue(): void {
    if (this.busy()) {
      return;
    }
    const next: AgentQueuedMessage | undefined = this.queueState()[0];
    if (next === undefined) {
      return;
    }
    this.queueState.update((queue: readonly AgentQueuedMessage[]): readonly AgentQueuedMessage[] =>
      queue.slice(1),
    );
    const images: readonly AiImageRef[] = next.images ?? [];
    this.push({ kind: 'user', text: next.text, ...(images.length === 0 ? {} : { images }) });
    this.startRun(
      next.text,
      next.owningTabId ?? this.lastOwningTabId,
      next.surface ?? this.lastSurface,
      images,
    );
  }

  /**
   * Rewinds the conversation to a prior user message and re-runs it with new text (unchanged text is
   * a retry of that turn). The transcript truncates to the messages before the rewind point — after
   * publishing the original line as a branch point so the hosting conversation preserves it — and
   * the run forks the provider session resumed up to the last kept assistant message, so discarded
   * turns never reach the model and the original session stays resumable. Without an anchor (no
   * session, or nothing kept) the branch starts a fresh session.
   * @param item The user item to rewind to.
   * @param text The message to resend from that point.
   * @param owningTabId The owning tab (as for {@link send}).
   * @param surface The run surface (as for {@link send}).
   */
  public rewind(item: AgentItem, text: string, owningTabId?: string, surface?: AgentSurface): void {
    const trimmed: string = text.trim();
    if (item.kind !== 'user' || trimmed.length === 0 || this.busy()) {
      return;
    }
    const items: readonly AgentItem[] = this.log();
    const index: number = items.findIndex(
      (candidate: AgentItem): boolean => candidate.id === item.id,
    );
    if (index < 0) {
      return;
    }
    const kept: readonly AgentItem[] = items.slice(0, index);
    this.branchState.update(
      (branch: AgentBranchPoint): AgentBranchPoint => ({
        epoch: branch.epoch + 1,
        origin: items,
        originSessionId: this.sessionIdState(),
      }),
    );
    const anchor: string | undefined = [...kept]
      .reverse()
      .find(
        (candidate: AgentItem): boolean =>
          candidate.kind === 'assistant' &&
          candidate.parentToolId === undefined &&
          candidate.providerMessageId !== undefined,
      )?.providerMessageId;
    this.log.set(kept);
    // A fork is a new conversation line: end the pre-fork live session and mint a fresh id so the
    // forked turn opens its own (it takes the transient resume/fork path via dispatchLive).
    this.resetAgentSession();
    if (anchor === undefined) {
      // Nothing to fork at: the branch starts a fresh session rather than resuming one that still
      // contains the discarded turns.
      this.sessionIdState.set(null);
      this.forkAt = null;
    } else {
      this.forkAt = anchor;
    }
    // The edited message keeps the original's attached images.
    const images: readonly AiImageRef[] = item.images ?? [];
    this.push({ kind: 'user', text: trimmed, ...(images.length === 0 ? {} : { images }) });
    this.startRun(trimmed, owningTabId, surface, images);
  }

  /**
   * Resolves the working directory a run should act within: a host-provided root (e.g. the repository
   * tab's bound repository) when present, otherwise the open folder workspace, or null for neither.
   * @returns Returns the workspace root path, or null.
   */
  private runWorkspaceRoot(): string | null {
    return this.workspaceRootResolver !== null
      ? this.workspaceRootResolver()
      : (this.workspace.root()?.path ?? null);
  }

  /**
   * Starts a run with the current engine selection and settings, recording the turn for retry and
   * queued-dispatch fallbacks. A pending branch anchor (set by {@link rewind}) forks the resumed
   * session at that message, once.
   * @param prompt The prompt to run.
   * @param owningTabId The owning tab (as for {@link send}).
   * @param surface The run surface (as for {@link send}).
   * @param images The images attached to the turn.
   * @param context The context the turn carries; defaults to what is currently attached, which the
   * turn then consumes. Stated only when re-running a turn that already took its own.
   */
  private startRun(
    prompt: string,
    owningTabId?: string,
    surface?: AgentSurface,
    images: readonly AiImageRef[] = [],
    context?: readonly AgentContextRef[],
  ): void {
    const attached: readonly AgentContextRef[] = context ?? this.contextPathsState();
    this.lastPrompt = prompt;
    this.lastImages = images;
    this.lastContext = attached;
    this.lastOwningTabId = owningTabId;
    this.lastSurface = surface;
    const forkAt: string | null = this.forkAt;
    this.forkAt = null;
    // A compaction just before this turn left a summary to seed the new session it started; fold it in
    // ahead of the prompt so the fresh session opens with the memory the summary distils, then consume
    // it so later turns (which resume this session) are not re-seeded.
    const seed: string | null = this.pendingContextSeed;
    this.pendingContextSeed = null;
    const runPrompt: string =
      seed === null
        ? prompt
        : `Summary of the conversation so far, for context:\n\n${seed}\n\n---\n\n${prompt}`;
    this.busy.set(true);
    this.activeRequestId = this.runtime.run(this.provider(), runPrompt, {
      agentSessionId: this.agentSessionId,
      workspaceRoot: this.runWorkspaceRoot(),
      model: this.model(),
      permissionPosture: this.settings.aiPermissionPosture(),
      toolPolicies: this.settings.aiToolPolicies(),
      allowedWritePaths: this.settings.aiAllowedWritePaths(),
      deniedWritePaths: this.settings.aiDeniedWritePaths(),
      allowedNetworkLocations: this.settings.aiAllowedNetworkLocations(),
      deniedNetworkLocations: this.settings.aiDeniedNetworkLocations(),
      tokenCap: this.settings.aiTokenCap(),
      agentShell: this.settings.aiAgentShell(),
      claudeExecutable: {
        mode: this.settings.aiClaudeExecutable(),
        path: this.settings.aiClaudeExecutablePath(),
      },
      runTimeoutMs: this.settings.aiRunTimeoutMinutes() * 60_000,
      agentSessionLifetimeMs: this.settings.aiAgentSessionLifetimeMinutes() * 60_000,
      owningTabId,
      surface,
      mode: this.modeState(),
      ...(this.effortState() === null ? {} : { effort: this.effortState()! }),
      ...(this.remoteControl() === 'off' ? {} : { remoteControl: this.remoteControl() }),
      contextPaths: attached,
      resumeSessionId: this.sessionIdState(),
      ...(forkAt === null ? {} : { resumeSessionAt: forkAt, forkSession: true }),
      ...(images.length === 0 ? {} : { images }),
    });
    // The attachments belong to the message that carried them: the turn takes them, and the composer
    // starts clean rather than silently resending them on every later turn.
    this.contextPathsState.set([]);
    this.logger.info(
      'Agent',
      `Prompt dispatched to '${this.provider()}'`,
      this.activeRequestId,
      this.model(),
    );
  }

  /**
   * Sets how much autonomy the conversation's runs use.
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  public setMode(mode: AgentMode): void {
    this.modeState.set(mode);
  }

  /**
   * Sets the reasoning-effort level the conversation's runs use (#330), or null for the provider
   * default. Takes effect on the next turn (and, for a held-open live session, on its next reopen).
   * @param effort The effort level, or null for the provider default.
   */
  public setEffort(effort: AiEffort | null): void {
    this.effortState.set(effort);
  }

  /**
   * Exposes this conversation's session via the provider's Remote Control feature (#331), or stops
   * exposing it. What exposure means is the user's global Remote control posture, not an argument here.
   *
   * The provider binds the bridge when it opens the session, so a live session is ended on a change:
   * the next turn reopens it — resuming the same provider conversation — with the bridge in its new
   * state, rather than the toggle sitting on while nothing is actually exposed. A session mid-run is
   * left alone (ending it would abort the run); that turn finishes, and the change lands on the next.
   * @param enabled Whether the session is exposed.
   */
  public setRemoteControlEnabled(enabled: boolean): void {
    if (this.remoteControlState() === enabled) {
      return;
    }
    this.remoteControlState.set(enabled);
    this.logger.info(
      'Agent',
      `Remote control ${enabled ? 'enabled' : 'disabled'}`,
      this.remoteControl(),
    );
    if (!this.busy()) {
      this.runtime.closeSession(this.agentSessionId);
      this.agentSessionId = crypto.randomUUID();
    }
  }

  /**
   * Attaches a file or folder to the conversation's context, ignoring a path already attached.
   * @param ref The file or folder to attach.
   */
  public attachContext(ref: AgentContextRef): void {
    if (
      this.contextPathsState().some(
        (existing: AgentContextRef): boolean => existing.path === ref.path,
      )
    ) {
      return;
    }
    this.contextPathsState.update(
      (refs: readonly AgentContextRef[]): readonly AgentContextRef[] => [...refs, ref],
    );
  }

  /**
   * Removes an attached file or folder from the conversation's context.
   * @param path The path to detach.
   */
  public removeContext(path: string): void {
    this.contextPathsState.update((refs: readonly AgentContextRef[]): readonly AgentContextRef[] =>
      refs.filter((ref: AgentContextRef): boolean => ref.path !== path),
    );
  }

  /**
   * Removes everything attached to the conversation's context.
   */
  public clearContext(): void {
    this.contextPathsState.set([]);
  }

  /**
   * Stops the in-flight run.
   */
  public stop(): void {
    if (this.activeRequestId !== null) {
      this.logger.info('Agent', 'Run interrupted', this.activeRequestId);
      this.runtime.abort(this.activeRequestId);
    }
  }

  /**
   * Compacts the conversation: runs a read-only summarisation turn over the current transcript, then
   * replaces the transcript with the single summary it produces. Blank transcripts and concurrent runs
   * are ignored. The summary streams as a live run (the working indicator shows) and lands as one
   * assistant item once complete.
   */
  public compact(): void {
    const history: readonly AgentItem[] = this.log();
    if (this.busy() || history.length === 0) {
      return;
    }
    this.compacting = true;
    this.compactionText = '';
    this.busy.set(true);
    this.logger.info('Agent', 'Compaction run started', history.length);
    this.activeRequestId = this.runtime.run(this.provider(), this.compactionPrompt(history), {
      workspaceRoot: this.runWorkspaceRoot(),
      model: this.model(),
      permissionPosture: 'prompt',
      tokenCap: this.settings.aiTokenCap(),
      runTimeoutMs: this.settings.aiRunTimeoutMinutes() * 60_000,
      mode: 'chat',
    });
  }

  /**
   * Ends this conversation's current live session (if any) and mints a fresh session id, so the next
   * turn opens a new session. Called when the conversation identity changes: New chat, restore, fork.
   */
  private resetAgentSession(): void {
    this.runtime.closeSession(this.agentSessionId);
    this.agentSessionId = crypto.randomUUID();
    // A fresh session carries no compaction seed of its own; drop any that a prior compaction left
    // unconsumed so it never leaks into an unrelated conversation (New chat, restore, fork).
    this.pendingContextSeed = null;
  }

  /**
   * Clears the transcript.
   */
  public clear(): void {
    this.logger.info('Agent', 'Conversation cleared');
    this.resetAgentSession();
    this.discardStream();
    this.log.set([]);
    this.activeRequestId = null;
    this.busy.set(false);
    this.contextPathsState.set([]);
    this.sessionIdState.set(null);
    this.contextTokensState.set(0);
    this.costUsdState.set(0);
    this.queueState.set([]);
  }

  /**
   * Replaces the transcript with a restored conversation, ending any in-flight run and reseeding the
   * id counter past the restored items so subsequently appended items keep unique ids. Used to
   * rehydrate a persisted conversation into this session.
   * @param items The restored transcript items.
   * @param sessionId The persisted provider session to resume on the next turn, so the restored
   * conversation keeps its memory; null when the conversation has no session yet.
   * @param queue The persisted queued-message texts, waiting to dispatch after the next completed
   * run (they capture no tab/surface; dispatch falls back to the next turn's).
   */
  public restore(
    items: readonly AgentItem[],
    sessionId: string | null = null,
    queue: readonly string[] = [],
  ): void {
    this.logger.info('Agent', 'Conversation restored', items.length, sessionId);
    this.resetAgentSession();
    this.activeRequestId = null;
    this.busy.set(false);
    this.contextPathsState.set([]);
    this.sessionIdState.set(sessionId);
    this.queueState.set(
      queue
        .filter((text: string): boolean => text.trim().length > 0)
        .map((text: string): AgentQueuedMessage => {
          this.queueSequence += 1;
          return { id: `queued-${this.queueSequence}`, text };
        }),
    );
    // Usage is not persisted with the conversation; it refills from the next turn's reported counts.
    this.contextTokensState.set(0);
    this.costUsdState.set(0);
    this.discardStream();
    this.sequence = items.reduce((max: number, item: AgentItem): number => {
      const parsed: number = Number.parseInt(item.id.replace(/^item-/, ''), 10);
      return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 0);
    // A restored question can no longer be answered (its run is gone), so a persisted pending state
    // is normalised to dismissed rather than locking the composer into answer mode. Choices persisted
    // by the earlier protocol as plain strings are lifted to labelled choices.
    this.log.set(
      items.map((item: AgentItem): AgentItem => {
        if (item.kind === 'edit-decision' && item.decisionState === 'pending') {
          return { ...item, decisionState: 'dismissed' };
        }
        if (item.kind !== 'input-request') {
          return item;
        }
        return {
          ...item,
          inputState: item.inputState === 'pending' ? 'dismissed' : item.inputState,
          inputChoices: (item.inputChoices ?? []).map(
            (choice: AiInputChoice | string): AiInputChoice =>
              typeof choice === 'string' ? { label: choice } : choice,
          ),
        };
      }),
    );
  }

  /**
   * Answers a pending permission request, optionally telling the broker to remember a grant.
   * @param item The permission item.
   * @param granted Whether the user granted permission.
   * @param remember How long the broker remembers a grant (undefined for this one use only; ignored
   * on a denial).
   */
  public respondPermission(
    item: AgentItem,
    granted: boolean,
    remember?: AiPermissionRemember,
  ): void {
    if (item.permissionId === undefined || item.permissionState !== 'pending') {
      return;
    }
    const scope: AiPermissionRemember | undefined = granted ? remember : undefined;
    this.runtime.respondPermission(item.permissionId, granted, scope);
    this.update(
      item.id,
      (existing: AgentItem): AgentItem => ({
        ...existing,
        permissionState: granted ? 'allowed' : 'denied',
        ...(scope === undefined ? {} : { permissionRemember: scope }),
      }),
    );
  }

  /**
   * Withdraws a still-pending permission prompt answered elsewhere — a remote peer approved or declined
   * the same tool call from another device (#331). The prompt is settled in the main process already, so this
   * only clears the local UI: the matching item drops its buttons and reads as answered on another
   * device. A no-op when the prompt is already settled or unknown.
   * @param permissionId The id of the permission prompt to withdraw.
   */
  private dismissPermission(permissionId: string): void {
    const item: AgentItem | undefined = this.items().find(
      (candidate: AgentItem): boolean =>
        candidate.permissionId === permissionId && candidate.permissionState === 'pending',
    );
    if (item === undefined) {
      return;
    }
    this.update(
      item.id,
      (existing: AgentItem): AgentItem => ({ ...existing, permissionState: 'dismissed' }),
    );
  }

  /**
   * Withdraws a still-pending agent question answered elsewhere — a remote peer answered the same
   * `ask_user` prompt from another device (#331). Clears the local UI only (the run is already resolved in
   * the main process): the matching item is marked dismissed. A no-op when already settled or unknown.
   * @param inputId The id of the question to withdraw.
   */
  private dismissInput(inputId: string): void {
    const item: AgentItem | undefined = this.items().find(
      (candidate: AgentItem): boolean =>
        candidate.inputId === inputId && candidate.inputState === 'pending',
    );
    if (item === undefined) {
      return;
    }
    this.update(
      item.id,
      (existing: AgentItem): AgentItem => ({ ...existing, inputState: 'dismissed' }),
    );
  }

  /**
   * Answers a pending edit decision (a staged edit preview), unblocking the run.
   * @param item The edit-decision item.
   * @param choice The user's decision.
   */
  public respondEditDecision(item: AgentItem, choice: AiEditDecision): void {
    if (item.decisionId === undefined || item.decisionState !== 'pending') {
      return;
    }
    this.runtime.respondEditDecision(item.decisionId, choice);
    this.update(
      item.id,
      (existing: AgentItem): AgentItem => ({
        ...existing,
        decisionState: choice === 'no' ? 'rejected' : 'applied',
        ...(choice === 'yes-auto' ? { decisionAuto: true } : {}),
      }),
    );
  }

  /**
   * Answers a pending input request (a question the agent asked), unblocking the run.
   * @param item The input-request item.
   * @param answer The user's answer, or null to decline (the agent is told and continues without
   * one).
   */
  public respondInput(item: AgentItem, answer: string | null): void {
    if (item.inputId === undefined || item.inputState !== 'pending') {
      return;
    }
    this.runtime.respondInput(item.inputId, answer);
    this.update(
      item.id,
      (existing: AgentItem): AgentItem =>
        answer === null
          ? { ...existing, inputState: 'dismissed' }
          : { ...existing, inputState: 'answered', inputAnswer: answer },
    );
  }

  /**
   * Folds a streamed event into the transcript.
   * @param event The event.
   */
  private onEvent(event: AiEvent): void {
    // Discovered commands are session-level, not per-turn: correlate them to this conversation by its
    // agent session id (#330), so a discovery answer that arrives between turns — when no run is active
    // — is not dropped by the per-turn request-id filter below.
    if (event.kind === 'commands') {
      if (event.agentSessionId === this.agentSessionId) {
        this.discoveredCommandsState.set(event.commands);
      }
      return;
    }
    // A settled background task is session-level, not per-turn: it can arrive after the launching turn
    // has ended (the conversation is idle, so activeRequestId is null and the per-turn filter below
    // would drop it). Correlate it by agent session id — as for `commands` — and surface it as a
    // spontaneous note plus a notification, keeping the agent's "I'll tell you when it's done" promise.
    // The task lifecycle is session-level for the same reason `commands` and `background-task` are: a
    // task outlives the turn that launched it, so the per-turn filter below would drop every update
    // that arrives once the conversation goes idle — which is most of them.
    if (
      event.kind === 'task-started' ||
      event.kind === 'task-progress' ||
      event.kind === 'task-updated'
    ) {
      if (event.agentSessionId === this.agentSessionId) {
        this.onTaskEvent(event);
      }
      return;
    }
    if (event.kind === 'background-task') {
      if (event.agentSessionId === this.agentSessionId) {
        this.settleTask(event.taskId, event.status, event.toolId);
        // Ambient housekeeping settles silently: it never earned a place in the transcript, so it does
        // not get a note or a notification. It still leaves the registry above.
        if (event.skipTranscript !== true) {
          this.onBackgroundTask(event.status, event.summary, event.requestId);
        } else {
          this.adoptReportBackTurn(event.requestId);
        }
      }
      return;
    }
    // A message a peer typed while remote-controlling the session (#331) is session-level: it can arrive
    // when no Studio-initiated turn is active (activeRequestId null), so the per-turn filter below would
    // drop it and everything the turn then streams. Echo it as the user's message and adopt the turn so
    // the response and any prompts render here too.
    if (event.kind === 'remote-message') {
      if (event.agentSessionId === this.agentSessionId) {
        this.flushStream();
        this.push({ kind: 'user', text: event.text });
        this.activeRequestId = event.requestId;
        this.busy.set(true);
      }
      return;
    }
    // A permission answered elsewhere (a remote peer on another device, #331) withdraws the still-pending
    // local prompt. It is matched by permission id, not the active turn, so it lands whichever turn is
    // in flight — handled ahead of the per-turn filter for the same reason as the events above.
    if (event.kind === 'permission-dismissed') {
      this.dismissPermission(event.permissionId);
      return;
    }
    // An agent question answered elsewhere (a remote peer on another device, #331) withdraws the pending
    // local question — matched by input id, not the active turn, for the same reason as above.
    if (event.kind === 'input-dismissed') {
      this.dismissInput(event.inputId);
      return;
    }
    if (event.requestId !== this.activeRequestId) {
      return;
    }
    // Anything other than a text delta must land AFTER whatever streamed text is buffered, so the
    // transcript order matches arrival order.
    if (event.kind !== 'text' && event.kind !== 'thinking') {
      this.flushStream();
    }
    // A compaction run's output does not join the transcript: its text is buffered and folded into a
    // single summary item when the run completes.
    if (this.compacting) {
      if (event.kind === 'text') {
        this.compactionText += event.delta;
      } else if (event.kind === 'status') {
        this.onCompactionStatus(event.state, event.detail);
      }
      return;
    }
    switch (event.kind) {
      case 'text':
        this.appendText('assistant', event.delta, event.parentToolId, event.messageUuid);
        break;
      case 'thinking':
        this.appendText('thinking', event.delta, event.parentToolId);
        break;
      case 'tool-start':
        this.push({
          kind: 'tool',
          text: '',
          toolId: event.toolId,
          toolName: event.name,
          toolDetail: event.detail,
          toolState: 'running',
          ...(event.input === undefined ? {} : { toolInput: event.input }),
          ...(event.parentToolId === undefined ? {} : { parentToolId: event.parentToolId }),
          ...(event.agentType === undefined ? {} : { agentType: event.agentType }),
        });
        break;
      case 'tool-end':
        this.endTool(event.toolId, event.ok, event.output);
        break;
      case 'permission':
        this.push({
          kind: 'permission',
          text: '',
          permissionId: event.permissionId,
          permissionName: event.name,
          permissionDetail: event.detail,
          permissionState: 'pending',
          permissionHasWorkspace: event.hasWorkspace,
        });
        break;
      case 'input-request':
        this.push({
          kind: 'input-request',
          text: '',
          inputId: event.inputId,
          inputQuestion: event.question,
          inputChoices: event.choices,
          inputState: 'pending',
        });
        break;
      case 'edit-decision':
        this.push({
          kind: 'edit-decision',
          text: '',
          decisionId: event.decisionId,
          decisionName: event.name,
          decisionDetail: event.detail,
          decisionState: 'pending',
          decisionHasDiff: event.hasDiff,
        });
        break;
      case 'session':
        // Remember the session so the next turn resumes it and the model keeps this conversation's
        // context. A compaction run's session is ignored above (its events never reach here).
        this.sessionIdState.set(event.sessionId);
        break;
      case 'usage': {
        // A sub-agent's usage lands on its lane's Task tool item and never touches the top-level
        // context meter (its window is separate). Like the meter, each event is a snapshot of the
        // sub-agent's occupancy at that round-trip, not a running total — a sub-agent's context grows
        // monotonically, so the latest snapshot is its peak. Summing them would re-count the re-sent
        // (cached) context on every round-trip and balloon the figure into the millions.
        if (event.parentToolId !== undefined) {
          this.setAgentTokens(event.parentToolId, event.inputTokens + event.outputTokens);
          break;
        }
        // This usage is a snapshot of the context window's occupancy at the turn's final model
        // round-trip (input folds in the whole re-sent conversation), so it stands as the new context
        // size rather than adding to a running total. Cost, in contrast, accumulates. Compaction-run
        // usage never reaches here (handled and returned above), so the meter is not spiked by it.
        this.contextTokensState.set(event.inputTokens + event.outputTokens);
        const cost: number | null = event.costUsd;
        if (cost !== null) {
          this.costUsdState.update((total: number): number => total + cost);
        }
        break;
      }
      case 'status':
        this.onStatus(event.state, event.detail);
        break;
      // 'commands' is session-level and handled at the top of onEvent (before the per-turn filter).
      default:
        break;
    }
  }

  /**
   * Handles a run lifecycle change, ending the run on a terminal state. Every terminal state leaves a
   * visible mark so a run never just stops with no explanation: an error shows its reason, a stop is
   * noted, and a run that completed without producing any output says so.
   * @param state The new state.
   * @param detail A short description carried by the event (the failure reason on an error).
   */
  private onStatus(state: AiRunState, detail: string): void {
    if (state === 'started') {
      return;
    }
    this.busy.set(false);
    this.activeRequestId = null;
    // A question the run never got answered can no longer be answered: mark it dismissed so the
    // composer leaves answer mode and the transcript reads coherently.
    this.dismissPendingInputs();
    if (state === 'error') {
      this.logger.error('Agent', `Run failed: ${this.failureCause(detail)}`);
      this.pushError(detail);
      this.maybePromptLogin(detail);
    } else if (state === 'aborted') {
      this.push({ kind: 'assistant', text: '_Stopped._' });
    } else if (state === 'completed') {
      // A not-signed-in turn can come back as a completed reply ("Not logged in. Please run /login")
      // rather than a hard error, so the reply is checked here too — otherwise the prompt would only
      // ever appear for failures that reach the error state. The strict match (the reply *is* that
      // message, not one that merely mentions login) guards the removal below.
      if (isNotLoggedInReply(this.lastReplyText())) {
        this.logger.warn('Agent', 'Turn returned a sign-in message; prompting Claude login');
        // Drop the sign-in reply so it neither lingers in the transcript nor merges with — and cannot
        // re-trigger this check on — the fresh reply the post-login re-run streams in.
        this.removeLastReply();
        this.retryAfterLogin = true;
        this.needsLoginState.set(true);
      } else if (!this.producedReply()) {
        this.push({ kind: 'assistant', text: '_The model returned no output._' });
      }
    }
    this.notifyRunEnded(state, detail);
    // A completed run dispatches the next queued message; a failed or stopped run holds the queue so
    // messages never fire into a broken or deliberately-stopped conversation.
    if (state === 'completed') {
      this.dispatchQueue();
    }
  }

  /**
   * Raises the "not signed in to Claude" prompt when a failed run looks like an expired or absent Claude
   * login. The common case is recognised straight from the error text ({@link looksLikeAuthFailure}) so
   * the modal appears immediately with no dependence on a main-process round-trip; for a run through the
   * Claude local-login connection whose wording is unfamiliar, an authoritative `claude auth status`
   * check backs it up. An ordinary failure (a network blip, a tool error) matches neither, so it never
   * surfaces a sign-in modal.
   * @param detail The failure detail carried by the error status event.
   */
  private maybePromptLogin(detail: string): void {
    if (looksLikeAuthFailure(detail)) {
      this.logger.warn('Agent', 'Run failed with a sign-in error; prompting Claude login');
      this.retryAfterLogin = true;
      this.needsLoginState.set(true);
      return;
    }
    if (this.engine.connection(this.provider())?.auth !== 'claude-login') {
      return;
    }
    void this.runtime
      .checkClaudeAuth()
      .then((loggedIn: boolean): void => {
        if (!loggedIn) {
          this.logger.warn('Agent', 'Claude login expired or absent; prompting sign-in');
          this.retryAfterLogin = true;
          this.needsLoginState.set(true);
        }
      })
      .catch((): void => {
        // A failed status check (for example the login IPC being unavailable) must not swallow the
        // prompt: the run already failed, so err towards offering sign-in.
        this.retryAfterLogin = true;
        this.needsLoginState.set(true);
      });
  }

  /**
   * Dismisses the "not signed in to Claude" prompt. Called when the user closes the login modal without
   * signing in.
   */
  public dismissLoginPrompt(): void {
    this.needsLoginState.set(false);
  }

  /**
   * Opens the sign-in modal on the user's own request (the `/login` command), rather than in reaction to
   * a failed turn — so a successful sign-in does not re-run anything.
   */
  public promptLogin(): void {
    this.logger.info('Agent', 'Sign-in requested via /login');
    this.retryAfterLogin = false;
    this.needsLoginState.set(true);
  }

  /**
   * Signs the user out of Claude (the `/logout` command) and closes the live session, so the next turn
   * runs signed out (and surfaces the sign-in prompt). Chiefly a way to exercise the sign-in flow from
   * within the app.
   */
  public async logout(): Promise<void> {
    this.logger.info('Agent', 'Signing out of Claude');
    await this.runtime.logoutClaude();
    this.resetAgentSession();
    this.notifications.notify({
      severity: 'info',
      title: 'Signed out of Claude',
      actions: [],
      key: 'agent:logout',
      route: 'default',
    });
  }

  /**
   * Completes a successful in-app sign-in. The turn that failed did so through a live Claude session that
   * was spawned while signed out — an already-running process never picks up the new credentials — so
   * that session is closed (its provider session id is kept, so the conversation's context resumes) and
   * the last prompt is re-run: the fresh session the re-run opens reads the new login. This is why the
   * re-run happens here rather than via the error card's Retry, which a completed "not logged in" turn
   * never leaves.
   */
  public onLoginSucceeded(): void {
    this.logger.info('Agent', 'Sign-in succeeded; reopening the session');
    this.needsLoginState.set(false);
    this.resetAgentSession();
    const retry: boolean = this.retryAfterLogin;
    this.retryAfterLogin = false;
    if (retry && this.lastPrompt !== null && !this.busy()) {
      this.logger.info('Agent', 'Re-running the turn that needed sign-in');
      this.startRun(
        this.lastPrompt,
        this.lastOwningTabId,
        this.lastSurface,
        this.lastImages,
        this.lastContext,
      );
    }
  }

  /**
   * Raises a notification for a run that ended on its own — completed or failed. An aborted run is
   * the user's own Stop and stays silent. When the conversation is on screen (its owning tab, or
   * Mission Control, is active) the outcome is recorded in the history without a toast; otherwise a
   * toast offers to jump to the owning tab.
   * @param state The terminal state.
   * @param detail The failure reason carried by an error event.
   */
  private notifyRunEnded(state: AiRunState, detail: string): void {
    if (state !== 'completed' && state !== 'error') {
      return;
    }
    const tabId: string | undefined = this.lastOwningTabId;
    const label: string =
      this.tabs.tabs().find((tab: Tab): boolean => tab.id === tabId)?.title ?? 'Agent';
    const watching: boolean = this.isConversationVisible(tabId);
    const actions: readonly NotificationAction[] =
      tabId === undefined || watching
        ? []
        : [{ label: 'Show', run: (): void => this.tabs.activate(tabId) }];
    const failed: boolean = state === 'error';
    this.notifications.notify({
      severity: failed ? 'error' : 'success',
      title: failed ? `Agent failed — ${label}` : `Agent finished — ${label}`,
      ...(failed ? { detail: this.failureCause(detail) } : {}),
      actions,
      key: `agent:${tabId ?? 'panel'}`,
      route: watching ? 'history-only' : 'default',
    });
  }

  /**
   * Surfaces a settled background task: appends a spontaneous note to the transcript so the completion
   * the agent promised to report is actually recorded, and raises a notification so a conversation off
   * screen still learns of it. Never touches the run state — the conversation may be idle (the common
   * case, the task outliving its launching turn) or mid next-turn, and either way this is an out-of-band
   * note, not a turn.
   * @param status How the task settled.
   * @param summary The one-line summary of what the task did.
   * @param requestId The request id the settle arrived under, adopted when the agent reports back.
   */
  private onBackgroundTask(
    status: 'completed' | 'failed' | 'stopped',
    summary: string,
    requestId: string,
  ): void {
    this.adoptReportBackTurn(requestId);
    const detail: string = summary.trim();
    const word: string =
      status === 'completed' ? 'finished' : status === 'failed' ? 'failed' : 'was stopped';
    const note: string =
      detail.length > 0 ? `_Background task ${word}:_ ${detail}` : `_Background task ${word}._`;
    // Sealed: the report the agent is about to stream must start its own message. Without this the
    // first text chunk folds into the note (same `assistant` kind, trailing item) and you get
    // "…completed (exit code 0)The command completed." run together in one bubble — which only shows
    // up when the agent leads with plain text, since a thinking block would break the run for you.
    this.push({ kind: 'assistant', text: note, sealed: true });
    const tabId: string | undefined = this.lastOwningTabId;
    const label: string =
      this.tabs.tabs().find((tab: Tab): boolean => tab.id === tabId)?.title ?? 'Agent';
    const watching: boolean = this.isConversationVisible(tabId);
    const actions: readonly NotificationAction[] =
      tabId === undefined || watching
        ? []
        : [{ label: 'Show', run: (): void => this.tabs.activate(tabId) }];
    this.notifications.notify({
      severity: status === 'failed' ? 'warning' : 'info',
      title: `Background task ${word} — ${label}`,
      ...(detail.length > 0 ? { detail } : {}),
      actions,
      key: `agent-task:${tabId ?? 'panel'}`,
      route: watching ? 'history-only' : 'default',
    });
  }

  /**
   * Folds a task-lifecycle event into the registry: a start opens an entry, progress and updates merge
   * into it. The provider sends `task-updated` as a **patch** of only what changed, so absent fields are
   * left alone rather than overwritten — replacing the entry wholesale would blank the description and
   * usage every time a status flips.
   * @param event The task-started, task-progress or task-updated event.
   */
  private onTaskEvent(event: AiTaskStartedEvent | AiTaskProgressEvent | AiTaskUpdatedEvent): void {
    this.taskState.update((tasks: readonly AgentTask[]): readonly AgentTask[] => {
      const existing: AgentTask | undefined = tasks.find(
        (task: AgentTask): boolean => task.taskId === event.taskId,
      );
      if (event.kind === 'task-started') {
        const opened: AgentTask = {
          taskId: event.taskId,
          description: event.description,
          tokens: 0,
          toolUses: 0,
          durationMs: 0,
          status: 'running',
          backgrounded: false,
          skipTranscript: event.skipTranscript === true,
          ...(event.toolId === undefined ? {} : { toolId: event.toolId }),
          ...(event.agentType === undefined ? {} : { agentType: event.agentType }),
          ...(event.workflowName === undefined ? {} : { workflowName: event.workflowName }),
        };
        return existing === undefined ? [...tasks, opened] : tasks;
      }
      // Progress and updates for a task this conversation never saw start are dropped: opening an entry
      // from them would strand a task nothing can settle.
      if (existing === undefined) {
        return tasks;
      }
      const merged: AgentTask =
        event.kind === 'task-progress'
          ? {
              ...existing,
              description: event.description,
              tokens: event.tokens,
              toolUses: event.toolUses,
              durationMs: event.durationMs,
              ...(event.lastToolName === undefined ? {} : { lastToolName: event.lastToolName }),
            }
          : {
              ...existing,
              ...(event.description === undefined ? {} : { description: event.description }),
              ...(event.backgrounded === undefined ? {} : { backgrounded: event.backgrounded }),
              ...(event.status === 'pending' ||
              event.status === 'running' ||
              event.status === 'paused'
                ? { status: event.status }
                : {}),
            };
      return tasks.map(
        (task: AgentTask): AgentTask => (task.taskId === event.taskId ? merged : task),
      );
    });
    // A terminal patch settles the task even when no `background-task` follows — a task that ends in
    // the foreground never sends one.
    if (
      event.kind === 'task-updated' &&
      (event.status === 'completed' || event.status === 'failed' || event.status === 'killed')
    ) {
      this.settleTask(event.taskId, event.status === 'completed' ? 'completed' : 'failed');
    }
  }

  /**
   * Removes a settled task from the registry and resolves the tool card it was holding open.
   * @param taskId The settled task's identifier.
   * @param status How it settled.
   * @param toolId The launching tool use, when the settle reported one.
   */
  private settleTask(
    taskId: string,
    status: 'completed' | 'failed' | 'stopped' | 'killed',
    toolId?: string,
  ): void {
    const settled: AgentTask | undefined = this.taskState().find(
      (task: AgentTask): boolean => task.taskId === taskId,
    );
    this.taskState.update((tasks: readonly AgentTask[]): readonly AgentTask[] =>
      tasks.filter((task: AgentTask): boolean => task.taskId !== taskId),
    );
    // The card was parked in `backgrounded` while the task ran; now it can say how it went. The settle
    // does not always carry the tool use, so fall back to the one recorded when the task started.
    const card: string | undefined = toolId ?? settled?.toolId;
    if (card === undefined) {
      return;
    }
    const ok: boolean = status === 'completed';
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map(
        (item: AgentItem): AgentItem =>
          item.kind === 'tool' && item.toolId === card && item.toolState === 'backgrounded'
            ? { ...item, toolState: ok ? 'ok' : 'error' }
            : item,
      ),
    );
  }

  /**
   * Adopts the turn the CLI starts on its own when a backgrounded task settles (#426), so the report it
   * writes renders in this conversation instead of being dropped.
   *
   * Diagnosed rather than assumed: the harness genuinely does resume by itself a second or two after the
   * settle (`task_notification` → `init` → assistant text → `result`). Nothing was missing from the
   * agent's side; the messages were arriving under the launching turn's request id while
   * {@link activeRequestId} was already null, so the per-turn filter in {@link onEvent} discarded every
   * one of them. Adopting that request id is the whole fix — no synthetic prompt is sent, and no tokens
   * are spent beyond what the harness was already going to spend.
   *
   * Declined in two cases. When the setting is off the conversation stays idle and the caller's note and
   * notification are the whole story. When a turn is already in flight the settle is genuinely
   * out-of-band — the user has moved on and asked for something else — and clobbering
   * {@link activeRequestId} would strand that turn's spinner.
   * @param requestId The request id the settle arrived under, which the report will also arrive under.
   */
  private adoptReportBackTurn(requestId: string): void {
    if (!this.settings.aiReportBackgroundTasks() || this.activeRequestId !== null) {
      return;
    }
    this.flushStream();
    this.activeRequestId = requestId;
    this.busy.set(true);
  }

  /**
   * Gets whether the conversation is on screen: its owning tab is active, or Mission Control (which
   * mirrors every live conversation) is.
   * @param tabId The owning tab's identifier, when known.
   * @returns Returns whether the conversation is visible.
   */
  private isConversationVisible(tabId: string | undefined): boolean {
    const active: Tab | undefined = this.tabs.activeTab();
    if (active === undefined) {
      return false;
    }
    return active.id === tabId || active.type === 'mission-control';
  }

  /**
   * Condenses a failure detail to its one-line cause for a toast (the structured transcript error
   * item carries the full diagnostics).
   * @param detail The failure detail carried by the status event.
   * @returns Returns the condensed cause.
   */
  private failureCause(detail: string): string {
    const reason: string =
      detail.trim().length > 0 ? detail.trim() : 'The agent run ended with an error.';
    const firstLine: string = reason.split('\n', 1)[0];
    return firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine;
  }

  /**
   * Folds a failed run into a structured error item: a one-line cause, the provider/model the run
   * went through, expandable diagnostics (the raw error, plus the failing tool's context when a tool
   * failure preceded the end), and the failed turn's prompt so the item offers a one-click retry.
   * @param detail The failure detail carried by the status event.
   */
  private pushError(detail: string): void {
    const reason: string =
      detail.trim().length > 0 ? detail.trim() : 'The agent run ended with an error.';
    const firstLine: string = reason.split('\n', 1)[0];
    const cause: string = firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine;
    const failedTool: AgentItem | undefined = [...this.log()]
      .reverse()
      .find((item: AgentItem): boolean => item.kind === 'tool' && item.toolState === 'error');
    const toolContext: string | undefined =
      failedTool === undefined
        ? undefined
        : `${failedTool.toolName ?? 'tool'}: ${failedTool.toolOutput ?? failedTool.toolDetail ?? 'failed'}`;
    this.push({
      kind: 'error',
      text: cause,
      errorProvider: this.providerReadout(),
      ...(reason === cause ? {} : { errorDetail: reason }),
      ...(toolContext === undefined ? {} : { errorToolContext: toolContext }),
      ...(this.lastPrompt === null ? {} : { errorPrompt: this.lastPrompt }),
      ...(this.lastImages.length === 0 ? {} : { errorImages: this.lastImages }),
      ...(this.lastContext.length === 0 ? {} : { errorContext: this.lastContext }),
    });
  }

  /**
   * Renders the provider/model readout attached to an error item (for example,
   * `Claude (Agent SDK) · claude-opus-4-8`).
   * @returns Returns the readout.
   */
  private providerReadout(): string {
    const id: string = this.provider();
    const label: string =
      this.engine.providers().find((info: AiProviderInfo): boolean => info.id === id)?.label ?? id;
    const model: string = this.model();
    return model.length > 0 ? `${label} · ${model}` : label;
  }

  /**
   * Retries the failed turn an error item records: the same prompt is re-run (resuming the session,
   * so the model keeps the conversation's context) without duplicating the user's message in the
   * transcript. Ignored while a run is in flight, once the item has been retried, or when the item
   * carries no prompt.
   * @param item The error item.
   * @param owningTabId The identifier of the tab hosting this agent (as for {@link send}).
   * @param surface What the run acts on (as for {@link send}).
   */
  public retry(item: AgentItem, owningTabId?: string, surface?: AgentSurface): void {
    const prompt: string | undefined = item.errorPrompt;
    if (
      item.kind !== 'error' ||
      item.errorRetried === true ||
      prompt === undefined ||
      this.busy()
    ) {
      return;
    }
    this.update(item.id, (existing: AgentItem): AgentItem => ({ ...existing, errorRetried: true }));
    this.startRun(prompt, owningTabId, surface, item.errorImages ?? [], item.errorContext ?? []);
  }

  /**
   * Ends a compaction run. On success the whole transcript is replaced with the single summary the run
   * produced; a failed or stopped compaction leaves the transcript untouched and notes what happened.
   * @param state The new state.
   * @param detail A short description carried by the event (the failure reason on an error).
   */
  private onCompactionStatus(state: AiRunState, detail: string): void {
    if (state === 'started') {
      return;
    }
    this.busy.set(false);
    this.activeRequestId = null;
    this.compacting = false;
    const summary: string = this.compactionText.trim();
    if (state === 'error') {
      const reason: string = detail.trim().length > 0 ? detail : 'unknown error';
      this.push({ kind: 'assistant', text: `_Compaction failed: ${reason}_` });
    } else if (state === 'aborted') {
      this.push({ kind: 'assistant', text: '_Compaction stopped._' });
    } else if (summary.length === 0) {
      this.push({ kind: 'assistant', text: '_Compaction produced no summary._' });
    } else {
      this.sequence += 1;
      this.log.set([
        {
          id: `item-${this.sequence}`,
          kind: 'assistant',
          text: `**Conversation summary**\n\n${summary}`,
        },
      ]);
      // Start a genuinely fresh provider session from the summary, rather than leaving the old one to
      // refill the meter on the next turn: end the held-open session and clear the resume id so the
      // next turn opens a new one, and seed that turn with the summary so the model keeps the memory
      // the summary distils. The context readout drops to zero now and refills — small — from the next
      // turn's reported usage.
      this.resetAgentSession();
      this.sessionIdState.set(null);
      this.contextTokensState.set(0);
      this.pendingContextSeed = summary;
    }
  }

  /**
   * Builds the summarisation prompt for a compaction run from the current transcript.
   * @param history The transcript to summarise.
   * @returns Returns the prompt.
   */
  private compactionPrompt(history: readonly AgentItem[]): string {
    const transcript: string = history
      .filter((item: AgentItem): boolean => item.kind === 'user' || item.kind === 'assistant')
      .map(
        (item: AgentItem): string => `${item.kind === 'user' ? 'User' : 'Assistant'}: ${item.text}`,
      )
      .join('\n\n');
    return (
      'Summarise the following conversation into a concise briefing that preserves the key facts, ' +
      'decisions, file names, code paths, and any open questions or next steps. Use short markdown ' +
      'sections. Do not use any tools — just write the summary.\n\n' +
      transcript
    );
  }

  /**
   * Gets a value indicating whether the run produced anything after the user's message (any assistant
   * text, reasoning, tool activity, or permission prompt). Used to flag an empty completion.
   * @returns Returns true when the last transcript item is not the user's prompt.
   */
  private producedReply(): boolean {
    const items: readonly AgentItem[] = this.log();
    const last: AgentItem | undefined = items[items.length - 1];
    return last !== undefined && last.kind !== 'user';
  }

  /**
   * Gets the text of the most recent assistant reply in the transcript, or the empty string when the
   * last turn produced none. Used to spot a sign-in message returned as a normal (completed) reply.
   * @returns Returns the last assistant reply's text.
   */
  private lastReplyText(): string {
    const items: readonly AgentItem[] = this.log();
    for (let index: number = items.length - 1; index >= 0; index -= 1) {
      const item: AgentItem = items[index];
      if (item.kind === 'assistant') {
        return item.text;
      }
      if (item.kind === 'user') {
        break;
      }
    }
    return '';
  }

  /**
   * Removes the most recent top-level assistant reply from the transcript (stopping at the user's
   * prompt). Used to drop a not-signed-in reply before the post-login re-run, so it neither lingers nor
   * merges into the re-run's fresh reply.
   */
  private removeLastReply(): void {
    const items: readonly AgentItem[] = this.log();
    for (let index: number = items.length - 1; index >= 0; index -= 1) {
      if (items[index].kind === 'user') {
        return;
      }
      if (items[index].kind === 'assistant') {
        const target: AgentItem = items[index];
        this.log.update((list: readonly AgentItem[]): readonly AgentItem[] =>
          list.filter((item: AgentItem): boolean => item !== target),
        );
        return;
      }
    }
  }

  /**
   * Appends streamed text to the trailing item of the same kind and sub-agent attribution, or starts
   * a new one. Matching on the attribution keeps interleaved parallel sub-agents (and the top-level
   * stream) from merging into one another's items.
   * @param kind The text item kind.
   * @param delta The text chunk.
   * @param parentToolId The sub-agent the text belongs to, or undefined for the top-level stream.
   * @param messageUuid The provider's message id the chunk belongs to (assistant chunks from
   * providers with sessions); the latest one folded into an item is its branch anchor.
   */
  private appendText(
    kind: 'assistant' | 'thinking',
    delta: string,
    parentToolId?: string,
    messageUuid?: string,
  ): void {
    // Deltas are buffered and folded into the transcript at most once per flush window, not once
    // per streamed token: every log write re-runs the transcript's row building, markdown parsing,
    // and autoscroll layout, and a fast stream (or several agents streaming at once) starved the
    // renderer — felt as input lag everywhere in the application. Ordering is preserved: any other
    // transcript mutation flushes the buffer first.
    const pending: typeof this.pendingStream = this.pendingStream;
    if (pending !== null && pending.kind === kind && pending.parentToolId === parentToolId) {
      pending.text += delta;
      if (messageUuid !== undefined) {
        pending.messageUuid = messageUuid;
      }
    } else {
      this.flushStream();
      this.pendingStream = { kind, text: delta, parentToolId, messageUuid };
    }
    this.streamFlushTimer ??= setTimeout((): void => {
      this.streamFlushTimer = null;
      this.flushStream();
    }, STREAM_FLUSH_MS);
  }

  /**
   * Folds the buffered streamed text into the transcript: into the trailing item when it continues
   * it, or as a new item. A no-op when nothing is buffered.
   */
  private flushStream(): void {
    const pending: typeof this.pendingStream = this.pendingStream;
    if (pending === null) {
      return;
    }
    this.pendingStream = null;
    this.perf.streamFlushed();
    const items: readonly AgentItem[] = this.log();
    const last: AgentItem | undefined = items[items.length - 1];
    if (
      last?.kind === pending.kind &&
      last.parentToolId === pending.parentToolId &&
      last.sealed !== true
    ) {
      // The matched item is the trailing one, so fold the chunk into the tail directly rather than
      // scanning the whole transcript for it (the hot streaming path).
      this.updateLast(
        (existing: AgentItem): AgentItem => ({
          ...existing,
          text: existing.text + pending.text,
          ...(pending.messageUuid === undefined ? {} : { providerMessageId: pending.messageUuid }),
        }),
      );
    } else {
      this.appendItem({
        kind: pending.kind,
        text: pending.text,
        ...(pending.parentToolId === undefined ? {} : { parentToolId: pending.parentToolId }),
        ...(pending.messageUuid === undefined ? {} : { providerMessageId: pending.messageUuid }),
      });
    }
  }

  /**
   * Drops any buffered streamed text and its flush timer, for transcript replacements (a clear, a
   * restore) where flushing would resurrect text of a conversation that is being discarded.
   */
  private discardStream(): void {
    this.pendingStream = null;
    if (this.streamFlushTimer !== null) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
  }

  /**
   * Sets a sub-agent's context occupancy on its lane's Task tool item, replacing any prior value. Each
   * round-trip reports the whole re-sent context, so the latest snapshot is the sub-agent's occupancy —
   * accumulating would re-count the cached context every round-trip.
   * @param toolId The Task tool use the tokens belong to.
   * @param tokens The latest snapshot's tokens (input plus output).
   */
  private setAgentTokens(toolId: string, tokens: number): void {
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map(
        (item: AgentItem): AgentItem =>
          item.kind === 'tool' && item.toolId === toolId ? { ...item, agentTokens: tokens } : item,
      ),
    );
  }

  /**
   * Marks every still-pending input request and edit decision dismissed (the run ended before the
   * user answered).
   */
  private dismissPendingInputs(): void {
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map((item: AgentItem): AgentItem => {
        if (item.kind === 'input-request' && item.inputState === 'pending') {
          return { ...item, inputState: 'dismissed' };
        }
        if (item.kind === 'edit-decision' && item.decisionState === 'pending') {
          return { ...item, decisionState: 'dismissed' };
        }
        return item;
      }),
    );
  }

  /**
   * Marks a tool item complete, attaching its raw output (or error detail) for the expanded
   * raw-detail view.
   * @param toolId The tool correlation id.
   * @param ok Whether the tool succeeded.
   * @param output The tool's raw output or error detail, or undefined for none.
   */
  private endTool(toolId: string, ok: boolean, output?: string): void {
    // A backgrounded tool returns its result the instant it backgrounds — "running in the background"
    // — so taking that at face value would flip the card to done while the work carries on for another
    // half hour. When a live task is registered against this tool use, the card stays live in a
    // `backgrounded` state and only resolves when the task actually settles.
    const backgrounded: boolean = this.tasks().some(
      (task: AgentTask): boolean => task.toolId === toolId,
    );
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map(
        (item: AgentItem): AgentItem =>
          item.kind === 'tool' && item.toolId === toolId
            ? {
                ...item,
                toolState: backgrounded ? 'backgrounded' : ok ? 'ok' : 'error',
                ...(output === undefined ? {} : { toolOutput: output }),
              }
            : item,
      ),
    );
  }

  /**
   * Appends a new item with a fresh identifier.
   * @param item The item without its id.
   */
  private push(item: Omit<AgentItem, 'id'>): void {
    // Any buffered streamed text precedes this item chronologically; fold it in first so the
    // transcript order matches arrival order.
    this.flushStream();
    this.appendItem(item);
  }

  /**
   * Appends a new item with a fresh identifier, without touching the stream buffer (the flush path
   * itself appends through here).
   * @param item The item without its id.
   */
  private appendItem(item: Omit<AgentItem, 'id'>): void {
    this.sequence += 1;
    const created: AgentItem = { id: `item-${this.sequence}`, ...item };
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] => [...items, created]);
  }

  /**
   * Replaces the item with the given id.
   * @param id The item id.
   * @param map The mapping applied to the item.
   */
  private update(id: string, map: (item: AgentItem) => AgentItem): void {
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map((item: AgentItem): AgentItem => (item.id === id ? map(item) : item)),
    );
  }

  /**
   * Replaces the trailing item, without scanning the transcript for it. Used by the streaming append,
   * which always folds a chunk into the last item; a single tail copy avoids the whole-array predicate
   * pass on every token. A no-op when the transcript is empty.
   * @param map The mapping applied to the last item.
   */
  private updateLast(map: (item: AgentItem) => AgentItem): void {
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] => {
      const lastIndex: number = items.length - 1;
      if (lastIndex < 0) {
        return items;
      }
      const next: AgentItem[] = items.slice();
      next[lastIndex] = map(next[lastIndex]);
      return next;
    });
  }
}
