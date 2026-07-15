import {
  computed,
  DestroyRef,
  effect,
  inject,
  Service,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type { AgentContextRef, AgentMode, AiModelInfo, AiProviderId } from '@shared/api/ai-types';
import {
  AgentConversationSummary,
  ConversationContext,
  contextIdOf,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';
import {
  Agent,
  AgentBranchPoint,
  AgentItem,
  AgentQueuedMessage,
} from '@shared/angular/services/agent/agent';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import {
  AGENT_CONVERSATION_CONTEXT,
  ConversationContextResolver,
  GLOBAL_CONVERSATION_CONTEXT,
} from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { AgentSessionHandle } from '@shared/angular/services/agent-sessions/agent-sessions';

/**
 * How long (ms) transcript changes are debounced before the conversation is persisted, so a streaming
 * run coalesces into a single write rather than saving on every delta.
 */
const SAVE_DEBOUNCE_MS: number = 700;

/**
 * The maximum length of a derived conversation title before it is truncated.
 */
const TITLE_MAX_LENGTH: number = 60;

/**
 * Owns one docked/tab agent conversation's lifecycle around a per-instance {@link Agent} session:
 * which stored conversation is open, autosaving the transcript under the host's context, rehydrating a
 * saved conversation, deleting conversations, and the history-list open/closed state. It is provided
 * per host (alongside {@link Agent}) so the host's chat, controls, and history list all drive one
 * conversation through the same instance — no component reaches into another. It implements
 * {@link AgentSessionHandle} so the agent tab can publish it to the ribbon via
 * {@link import('../agent-sessions/agent-sessions').AgentSessions}.
 */
@Service({ autoProvided: false })
export class AgentConversation implements AgentSessionHandle {
  /**
   * Holds the per-instance agent session this conversation wraps.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the conversation store client used to list, load, save, and delete conversations.
   */
  private readonly store: AgentConversations = inject(AgentConversations);

  /**
   * Holds the file-system client used to prompt for a file or folder when attaching context.
   */
  private readonly files: FileSystem = inject(FileSystem);

  /**
   * Holds the editor-commands registry, the source of the current editor selection when attaching it.
   */
  private readonly editors: EditorCommands = inject(EditorCommands);

  /**
   * Holds the tab registry, used to label an attached selection with its source tab's title.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Tracks the counter that keeps attached-selection labels unique within this conversation.
   */
  private selectionCounter: number = 0;

  /**
   * Holds the destroy notifier used to flush a pending debounced save when the host is torn down.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds the IDE-provided context resolver (workspace/repository), or null when the host carries no
   * IDE context.
   */
  private readonly resolver: ConversationContextResolver | null = inject(
    AGENT_CONVERSATION_CONTEXT,
    {
      optional: true,
    },
  );

  /**
   * Holds an explicit per-host context source (a file panel's reactive `fileContext` signal), bound
   * via {@link bindContext}; null until a host binds one.
   */
  private readonly explicitContext: WritableSignal<Signal<ConversationContext | undefined> | null> =
    signal<Signal<ConversationContext | undefined> | null>(null);

  /**
   * Gets the effective conversation context: an explicitly-bound source wins, else the injected IDE
   * resolver, else the global bucket. Reactive, so a file panel saving an untitled file moves the
   * conversation to its new file context.
   */
  public readonly context: Signal<ConversationContext> = computed((): ConversationContext => {
    const explicit: Signal<ConversationContext | undefined> | null = this.explicitContext();
    return explicit?.() ?? this.resolver?.() ?? GLOBAL_CONVERSATION_CONTEXT;
  });

  /**
   * Gets a value indicating whether a run is in flight (part of {@link AgentSessionHandle}).
   */
  public readonly isRunning: Signal<boolean> = this.agent.isRunning;

  /**
   * Gets the connection this conversation's runs go through (part of {@link AgentSessionHandle}).
   */
  public readonly provider: Signal<AiProviderId> = this.agent.provider;

  /**
   * Gets the model this conversation's runs go through (part of {@link AgentSessionHandle}).
   */
  public readonly model: Signal<string> = this.agent.model;

  /**
   * Gets the models offered by this conversation's effective provider (part of
   * {@link AgentSessionHandle}).
   */
  public readonly models: Signal<readonly AiModelInfo[]> = this.agent.models;

  /**
   * Gets how much autonomy the conversation's runs use (part of {@link AgentSessionHandle}).
   */
  public readonly mode: Signal<AgentMode> = this.agent.mode;

  /**
   * Gets the files and folders attached to the conversation's context (part of
   * {@link AgentSessionHandle}).
   */
  public readonly contextPaths: Signal<readonly AgentContextRef[]> = this.agent.contextPaths;

  /**
   * Gets a value indicating whether the conversation has any messages, so controls that act on the
   * transcript (such as Compact) can disable on an empty conversation.
   */
  public readonly hasMessages: Signal<boolean> = computed(
    (): boolean => this.agent.items().length > 0,
  );

  /**
   * Holds whether the conversation-history list is shown.
   */
  private readonly historyOpenState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether the conversation-history list is shown (part of
   * {@link AgentSessionHandle}).
   */
  public readonly historyOpen: Signal<boolean> = this.historyOpenState.asReadonly();

  /**
   * Holds whether the transcript follows new content to the bottom as it streams. On by default.
   */
  private readonly autoScrollState: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets a value indicating whether the transcript follows new content to the bottom as it streams
   * (part of {@link AgentSessionHandle}).
   */
  public readonly autoScroll: Signal<boolean> = this.autoScrollState.asReadonly();

  /**
   * Holds the id of the conversation currently open, or null for an unsaved/new conversation.
   */
  private readonly currentIdState: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the id of the conversation currently open, or null for an unsaved/new conversation.
   */
  public readonly currentId: Signal<string | null> = this.currentIdState.asReadonly();

  /**
   * Holds the stored conversation summaries for the current context, newest first.
   */
  private readonly summariesState: WritableSignal<readonly AgentConversationSummary[]> = signal<
    readonly AgentConversationSummary[]
  >([]);

  /**
   * Gets the stored conversation summaries for the current context, newest first.
   */
  public readonly summaries: Signal<readonly AgentConversationSummary[]> =
    this.summariesState.asReadonly();

  /**
   * Holds when the current conversation was first created (epoch ms), or 0 before its first save.
   */
  private createdAt: number = 0;

  /**
   * Holds the transcript reference last persisted or restored, so the autosave effect can skip an
   * unchanged transcript (including one it just rehydrated).
   */
  private savedRef: readonly AgentItem[] | null = null;

  /**
   * Holds the queued-messages reference last persisted or restored, so queue edits (enqueue, remove)
   * also schedule a save even when the transcript itself has not changed.
   */
  private savedQueueRef: readonly AgentQueuedMessage[] | null = null;

  /**
   * Holds the pending debounced-save timer, or null when none is scheduled.
   */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initializes a new instance of the {@link AgentConversation} class, wiring the autosave of the
   * transcript, the reload of the history summaries on context/visibility change, and the flush of a
   * pending save when the host is torn down.
   */
  public constructor() {
    effect((): void => {
      const items: readonly AgentItem[] = this.agent.items();
      const queue: readonly AgentQueuedMessage[] = this.agent.queued();
      untracked((): void => {
        if (items.length === 0) {
          this.currentIdState.set(null);
          this.createdAt = 0;
          this.savedRef = items;
          this.savedQueueRef = queue;
          return;
        }
        if (items === this.savedRef && queue === this.savedQueueRef) {
          return;
        }
        this.savedRef = items;
        this.savedQueueRef = queue;
        this.scheduleSave();
      });
    });

    effect((): void => {
      this.context();
      this.historyOpenState();
      untracked((): void => void this.reloadSummaries());
    });

    // A rewind publishes a branch point carrying the original line. Preserve that line as its own
    // record — under the conversation's current id, cancelling any save the truncation just
    // scheduled — and let the edited line continue as a new conversation, so the original stays
    // reachable in History rather than being overwritten.
    let seenBranchEpoch: number = 0;
    effect((): void => {
      const branch: AgentBranchPoint = this.agent.branch();
      untracked((): void => {
        if (branch.epoch === seenBranchEpoch) {
          return;
        }
        seenBranchEpoch = branch.epoch;
        if (branch.origin.length > 0) {
          void this.preserveBranchOrigin(branch);
        }
      });
    });

    this.destroyRef.onDestroy((): void => {
      if (this.saveTimer !== null) {
        this.cancelScheduledSave();
        void this.persist();
      }
    });
  }

  /**
   * Binds a host's explicit context source (a reactive signal), which wins over the injected IDE
   * resolver. A file panel binds its `fileContext` so the conversation follows the file.
   * @param source The context signal to read at resolution time.
   */
  public bindContext(source: Signal<ConversationContext | undefined>): void {
    this.explicitContext.set(source);
  }

  /**
   * Starts a fresh conversation, clearing the transcript and leaving the history list.
   */
  public newChat(): void {
    this.agent.clear();
    this.historyOpenState.set(false);
  }

  /**
   * Stops the in-flight run (part of {@link AgentSessionHandle}).
   */
  public stop(): void {
    this.agent.stop();
  }

  /**
   * Toggles the conversation-history list (part of {@link AgentSessionHandle}).
   */
  public toggleHistory(): void {
    this.historyOpenState.update((open: boolean): boolean => !open);
  }

  /**
   * Sets whether the transcript follows new content to the bottom as it streams (part of
   * {@link AgentSessionHandle}).
   * @param value The new auto-scroll preference.
   */
  public setAutoScroll(value: boolean): void {
    this.autoScrollState.set(value);
  }

  /**
   * Sets how much autonomy the conversation's runs use (part of {@link AgentSessionHandle}).
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  public setMode(mode: AgentMode): void {
    this.agent.setMode(mode);
  }

  /**
   * Selects the connection this conversation's runs go through (part of {@link AgentSessionHandle}).
   * @param id The connection id.
   */
  public setProvider(id: AiProviderId): void {
    this.agent.setProvider(id);
  }

  /**
   * Selects the model this conversation's runs go through (part of {@link AgentSessionHandle}).
   * @param id The model id.
   */
  public setModel(id: string): void {
    this.agent.setModel(id);
  }

  /**
   * Prompts for a file and attaches it to the conversation's context (part of
   * {@link AgentSessionHandle}).
   */
  public attachFile(): void {
    void this.attach('file');
  }

  /**
   * Prompts for a folder and attaches it to the conversation's context (part of
   * {@link AgentSessionHandle}).
   */
  public attachFolder(): void {
    void this.attach('folder');
  }

  /**
   * Attaches the current editor selection to the conversation's context (part of
   * {@link AgentSessionHandle}): the selected text is inlined into the next run's prompt. Does
   * nothing when no code editor has a selection.
   */
  public attachSelection(): void {
    const selection: { tabId: string; text: string } | null = this.editors.readActiveSelection();
    if (selection === null) {
      return;
    }
    const title: string =
      this.tabs.tabs().find((tab: Tab): boolean => tab.id === selection.tabId)?.title ?? 'editor';
    this.selectionCounter += 1;
    const lines: number = selection.text.split('\n').length;
    this.agent.attachContext({
      path: `${title} — selection #${this.selectionCounter} (${lines === 1 ? '1 line' : `${lines} lines`})`,
      kind: 'selection',
      content: selection.text,
    });
  }

  /**
   * Removes an attached file or folder from the conversation's context (part of
   * {@link AgentSessionHandle}).
   * @param path The path to detach.
   */
  public removeContext(path: string): void {
    this.agent.removeContext(path);
  }

  /**
   * Removes everything attached to the conversation's context (part of {@link AgentSessionHandle}).
   */
  public clearContext(): void {
    this.agent.clearContext();
  }

  /**
   * Compacts the conversation, replacing the transcript with a concise summary (part of
   * {@link AgentSessionHandle}).
   */
  public compact(): void {
    this.agent.compact();
  }

  /**
   * Prompts for a file or folder and attaches the chosen path to the conversation's context.
   * @param kind Whether to pick a file or a folder.
   */
  private async attach(kind: 'file' | 'folder'): Promise<void> {
    const path: string | null = await this.files.pickPath(kind);
    if (path !== null) {
      this.agent.attachContext({ path, kind });
    }
  }

  /**
   * Rehydrates a stored conversation into this session and returns to the chat.
   * @param id The conversation id to open.
   */
  public async open(id: string): Promise<void> {
    const record: StoredAgentConversation | null = await this.store.load(id);
    if (record === null) {
      return;
    }
    this.cancelScheduledSave();
    this.agent.restore(
      record.items as readonly AgentItem[],
      record.sessionId ?? null,
      (record.queue ?? []).filter((text: unknown): text is string => typeof text === 'string'),
    );
    this.currentIdState.set(record.id);
    this.createdAt = record.createdAt;
    // Capture the restored references so the autosave effect does not immediately re-save them.
    this.savedRef = this.agent.items();
    this.savedQueueRef = this.agent.queued();
    this.historyOpenState.set(false);
  }

  /**
   * Deletes the given conversations, starting a fresh conversation if the open one was removed, then
   * reloads the history summaries.
   * @param ids The conversation ids to delete.
   */
  public async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.store.delete(ids);
    const current: string | null = this.currentIdState();
    if (current !== null && ids.includes(current)) {
      this.agent.clear();
    }
    await this.reloadSummaries();
  }

  /**
   * Reloads the stored summaries for the current context.
   */
  private async reloadSummaries(): Promise<void> {
    const summaries: readonly AgentConversationSummary[] = await this.store.list(
      contextIdOf(this.context()),
    );
    this.summariesState.set(summaries);
  }

  /**
   * Saves a rewind's original line as its own conversation record and detaches the current id, so
   * the edited line continues under a fresh one. The original keeps its provider session, staying
   * fully resumable from History.
   * @param branch The branch point carrying the original transcript.
   */
  private async preserveBranchOrigin(branch: AgentBranchPoint): Promise<void> {
    this.cancelScheduledSave();
    const id: string = this.currentIdState() ?? crypto.randomUUID();
    const createdAt: number = this.createdAt > 0 ? this.createdAt : Date.now();
    this.currentIdState.set(null);
    this.createdAt = 0;
    const record: StoredAgentConversation = {
      id,
      contextId: contextIdOf(this.context()),
      title: this.deriveTitle(branch.origin),
      provider: this.agent.provider(),
      model: this.agent.model(),
      createdAt,
      updatedAt: Date.now(),
      messageCount: branch.origin.filter(
        (item: AgentItem): boolean => item.kind === 'user' || item.kind === 'assistant',
      ).length,
      items: branch.origin,
      sessionId: branch.originSessionId,
    };
    await this.store.save(record);
    await this.reloadSummaries();
  }

  /**
   * Schedules a debounced save of the current transcript, coalescing a streaming run's rapid updates
   * into a single write.
   */
  private scheduleSave(): void {
    this.cancelScheduledSave();
    this.saveTimer = setTimeout((): void => {
      this.saveTimer = null;
      void this.persist();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Cancels any pending debounced save.
   */
  private cancelScheduledSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Persists the current transcript under its context, minting a conversation id and creation time on
   * first save, then refreshes the history summaries. No-ops on an empty transcript.
   */
  private async persist(): Promise<void> {
    const items: readonly AgentItem[] = this.agent.items();
    if (items.length === 0) {
      return;
    }
    if (this.currentIdState() === null) {
      this.currentIdState.set(crypto.randomUUID());
      this.createdAt = Date.now();
    }
    const id: string | null = this.currentIdState();
    if (id === null) {
      return;
    }
    const context: ConversationContext = this.context();
    const messageCount: number = items.filter(
      (item: AgentItem): boolean => item.kind === 'user' || item.kind === 'assistant',
    ).length;
    const record: StoredAgentConversation = {
      id,
      contextId: contextIdOf(context),
      title: this.deriveTitle(items),
      provider: this.agent.provider(),
      model: this.agent.model(),
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount,
      items,
      sessionId: this.agent.sessionId(),
      ...(this.agent.queued().length === 0
        ? {}
        : { queue: this.agent.queued().map((entry: AgentQueuedMessage): string => entry.text) }),
    };
    await this.store.save(record);
    await this.reloadSummaries();
  }

  /**
   * Derives a conversation title from its first user message, trimmed and truncated.
   * @param items The transcript items.
   * @returns Returns the title, or a fallback when there is no user message yet.
   */
  private deriveTitle(items: readonly AgentItem[]): string {
    const first: AgentItem | undefined = items.find(
      (item: AgentItem): boolean => item.kind === 'user',
    );
    const text: string = (first?.text ?? '').trim().replace(/\s+/g, ' ');
    if (text.length === 0) {
      return 'New conversation';
    }
    return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH).trimEnd()}…` : text;
  }
}
