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
  AiEvent,
  AiImageRef,
  AiInputChoice,
  AiModelInfo,
  AiPermissionRemember,
  AiProviderId,
  AiProviderInfo,
  AiRunState,
} from '@shared/api/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { AgentEngine } from '../agent-engine/agent-engine';
import { Settings } from '@shared/angular/services/settings/settings';
import { Workspace } from '@shared/angular/services/workspace/workspace';

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
export type AgentToolState = 'running' | 'ok' | 'error';

/**
 * Identifies the state of a permission request item.
 */
export type AgentPermissionState = 'pending' | 'allowed' | 'denied';

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
    if (chosen !== null && models.some((candidate: AiModelInfo): boolean => candidate.id === chosen)) {
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
  }

  /**
   * Selects the model this conversation's runs go through.
   * @param id The model id.
   */
  public setModel(id: string): void {
    this.modelOverride.set(id);
  }

  /**
   * Holds the workspace, used to scope runs to the open folder.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the settings service, the source of the run's permission posture and token cap.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the destroy notifier used to unsubscribe this conversation from runtime events.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds the ordered transcript.
   */
  private readonly log: WritableSignal<readonly AgentItem[]> = signal<readonly AgentItem[]>([]);

  /**
   * Holds a value indicating whether a run is in flight.
   */
  private readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   * The user's choice persists across new chats within this session.
   */
  private readonly modeState: WritableSignal<AgentMode> = signal<AgentMode>('agent');

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
   * Holds a value indicating whether the in-flight run is a compaction run, whose streamed text is
   * buffered into {@link compactionText} and folded into a single summary item rather than appended.
   */
  private compacting: boolean = false;

  /**
   * Accumulates the summary text streamed by a compaction run.
   */
  private compactionText: string = '';

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
   * Gets how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   */
  public readonly mode: Signal<AgentMode> = this.modeState.asReadonly();

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
    return (
      this.models().find((model: AiModelInfo): boolean => model.id === id)?.contextWindow ?? 0
    );
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
    this.destroyRef.onDestroy(unsubscribe);
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
   * Starts a run with the current engine selection and settings, recording the turn for retry and
   * queued-dispatch fallbacks. A pending branch anchor (set by {@link rewind}) forks the resumed
   * session at that message, once.
   * @param prompt The prompt to run.
   * @param owningTabId The owning tab (as for {@link send}).
   * @param surface The run surface (as for {@link send}).
   * @param images The images attached to the turn.
   */
  private startRun(
    prompt: string,
    owningTabId?: string,
    surface?: AgentSurface,
    images: readonly AiImageRef[] = [],
  ): void {
    this.lastPrompt = prompt;
    this.lastImages = images;
    this.lastOwningTabId = owningTabId;
    this.lastSurface = surface;
    const forkAt: string | null = this.forkAt;
    this.forkAt = null;
    this.busy.set(true);
    this.activeRequestId = this.runtime.run(this.provider(), prompt, {
      workspaceRoot: this.workspace.root()?.path ?? null,
      model: this.model(),
      permissionPosture: this.settings.aiPermissionPosture(),
      tokenCap: this.settings.aiTokenCap(),
      runTimeoutMs: this.settings.aiRunTimeoutMinutes() * 60_000,
      owningTabId,
      surface,
      mode: this.modeState(),
      contextPaths: this.contextPathsState(),
      resumeSessionId: this.sessionIdState(),
      ...(forkAt === null ? {} : { resumeSessionAt: forkAt, forkSession: true }),
      ...(images.length === 0 ? {} : { images }),
    });
  }

  /**
   * Sets how much autonomy the conversation's runs use.
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  public setMode(mode: AgentMode): void {
    this.modeState.set(mode);
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
    this.activeRequestId = this.runtime.run(
      this.provider(),
      this.compactionPrompt(history),
      {
        workspaceRoot: this.workspace.root()?.path ?? null,
        model: this.model(),
        permissionPosture: 'prompt',
        tokenCap: this.settings.aiTokenCap(),
        runTimeoutMs: this.settings.aiRunTimeoutMinutes() * 60_000,
        mode: 'chat',
      },
    );
  }

  /**
   * Clears the transcript.
   */
  public clear(): void {
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
    if (event.requestId !== this.activeRequestId) {
      return;
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
      this.pushError(detail);
    } else if (state === 'aborted') {
      this.push({ kind: 'assistant', text: '_Stopped._' });
    } else if (state === 'completed' && !this.producedReply()) {
      this.push({ kind: 'assistant', text: '_The model returned no output._' });
    }
    // A completed run dispatches the next queued message; a failed or stopped run holds the queue so
    // messages never fire into a broken or deliberately-stopped conversation.
    if (state === 'completed') {
      this.dispatchQueue();
    }
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
    this.startRun(prompt, owningTabId, surface, item.errorImages ?? []);
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
      // The transcript is now just the compact summary; the context readout drops to zero and refills
      // from the next turn's reported usage.
      this.contextTokensState.set(0);
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
    const items: readonly AgentItem[] = this.log();
    const last: AgentItem | undefined = items[items.length - 1];
    if (last?.kind === kind && last.parentToolId === parentToolId) {
      this.update(
        last.id,
        (existing: AgentItem): AgentItem => ({
          ...existing,
          text: existing.text + delta,
          ...(messageUuid === undefined ? {} : { providerMessageId: messageUuid }),
        }),
      );
    } else {
      this.push({
        kind,
        text: delta,
        ...(parentToolId === undefined ? {} : { parentToolId }),
        ...(messageUuid === undefined ? {} : { providerMessageId: messageUuid }),
      });
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
          item.kind === 'tool' && item.toolId === toolId
            ? { ...item, agentTokens: tokens }
            : item,
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
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map(
        (item: AgentItem): AgentItem =>
          item.kind === 'tool' && item.toolId === toolId
            ? {
                ...item,
                toolState: ok ? 'ok' : 'error',
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
}
