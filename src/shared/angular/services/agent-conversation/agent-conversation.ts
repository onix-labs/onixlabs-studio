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
import type {
  AgentContextRef,
  AgentMode,
  AiModelInfo,
  AiProviderId,
  AiRemoteControlMode,
} from '@shared/api/ai-types';
import {
  AgentConversationAgentType,
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
import { Log } from '@shared/angular/services/log/log';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import {
  AGENT_CONVERSATION_CONTEXT,
  AGENT_CONVERSATION_KIND,
  agentTypeFromContextKind,
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
   * Holds the agent type this host declares for the conversations it creates (its primary metadata
   * chip), or null when the host declares none — in which case a type is derived from the context kind.
   */
  private readonly declaredAgentType: AgentConversationAgentType | null = inject(
    AGENT_CONVERSATION_KIND,
    { optional: true },
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
   * Gets whether this conversation's provider supports Remote Control (part of
   * {@link AgentSessionHandle}).
   */
  public readonly supportsRemoteControl: Signal<boolean> = this.agent.supportsRemoteControl;

  /**
   * Gets whether this conversation's session is exposed via Remote Control (part of
   * {@link AgentSessionHandle}).
   */
  public readonly remoteControlEnabled: Signal<boolean> = this.agent.remoteControlEnabled;

  /**
   * Gets the mode this conversation's session is exposed at — `off`, or the user's global Remote
   * control posture while it is exposed (part of {@link AgentSessionHandle}).
   */
  public readonly remoteControl: Signal<AiRemoteControlMode> = this.agent.remoteControl;

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
   * Holds the composer's unsent draft text. It lives on the conversation — not the transient chat
   * component — because a mirror surface (a Mission Control column) unmounts its chat when its tab is
   * left, and a draft held in the component would be lost on the next visit. Kept here it survives, and
   * is shared by every surface driving this one conversation (tab, docked panel, mirror).
   */
  public readonly draft: WritableSignal<string> = signal<string>('');

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
   * Holds the open conversation's user-chosen custom title, or null when its title is auto-derived from
   * the transcript. Kept so autosaves preserve a rename instead of re-deriving the title.
   */
  private customTitle: string | null = null;

  /**
   * Holds the open conversation's category id, or null when it is uncategorized. Kept so autosaves
   * preserve the conversation's filing.
   */
  private categoryId: string | null = null;

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
          this.customTitle = null;
          this.categoryId = null;
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
    this.log.info('AgentConversation', 'New conversation started');
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
   * Sets how much autonomy the conversation's runs use (part of {@link AgentSessionHandle}).
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  public setMode(mode: AgentMode): void {
    this.agent.setMode(mode);
  }

  /**
   * Exposes this conversation's session via Remote Control, or stops exposing it (part of
   * {@link AgentSessionHandle}).
   * @param enabled Whether the session is exposed.
   */
  public setRemoteControlEnabled(enabled: boolean): void {
    this.agent.setRemoteControlEnabled(enabled);
  }

  /**
   * Selects the connection the conversation's runs go through (part of {@link AgentSessionHandle}).
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
    this.customTitle = record.titleIsCustom ? record.title : null;
    this.categoryId = record.categoryId ?? null;
    // Capture the restored references so the autosave effect does not immediately re-save them.
    this.savedRef = this.agent.items();
    this.savedQueueRef = this.agent.queued();
    this.historyOpenState.set(false);
    this.log.info('AgentConversation', 'Conversation opened', record.id);
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
    this.log.info('AgentConversation', `Deleting ${ids.length} conversation(s)`);
    await this.store.delete(ids);
    const current: string | null = this.currentIdState();
    if (current !== null && ids.includes(current)) {
      this.agent.clear();
    }
    await this.reloadSummaries();
  }

  /**
   * Reloads the stored summaries. Every conversation is listed, across all contexts, so the history
   * tree shows all conversations regardless of the agent that created them.
   */
  private async reloadSummaries(): Promise<void> {
    const summaries: readonly AgentConversationSummary[] = await this.store.listAll();
    this.summariesState.set(summaries);
  }

  /**
   * Reloads the stored summaries on demand, so callers (the history list after a rename, move, or
   * category change) can refresh what is shown.
   */
  public async refresh(): Promise<void> {
    await this.reloadSummaries();
  }

  /**
   * Renames a conversation, giving it a user-chosen custom title that survives new messages. When the
   * renamed conversation is the one currently open, the change is mirrored into this session so a later
   * autosave preserves it.
   * @param id The conversation id to rename.
   * @param title The new title; a blank title is ignored.
   */
  public async rename(id: string, title: string): Promise<void> {
    const trimmed: string = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (id === this.currentIdState()) {
      this.customTitle = trimmed;
    }
    await this.store.updateMeta({ id, title: trimmed });
    await this.reloadSummaries();
  }

  /**
   * Files a conversation under a category, or clears its category when given null. A conversation always
   * remains visible under All Conversations regardless.
   * @param id The conversation id.
   * @param categoryId The category id to file it under, or null to remove it from its category.
   */
  public async setCategory(id: string, categoryId: string | null): Promise<void> {
    if (id === this.currentIdState()) {
      this.categoryId = categoryId;
    }
    await this.store.updateMeta({ id, categoryId });
    await this.reloadSummaries();
  }

  /**
   * Duplicates a conversation into a new, independent record (its own id, no provider session so the
   * copy starts its own memory), filed under the same category and marked as a copy in its title.
   * @param id The conversation id to duplicate.
   */
  public async duplicate(id: string): Promise<void> {
    const record: StoredAgentConversation | null = await this.store.load(id);
    if (record === null) {
      return;
    }
    const now: number = Date.now();
    const copy: StoredAgentConversation = {
      ...record,
      id: crypto.randomUUID(),
      title: `${record.title} (copy)`,
      titleIsCustom: true,
      createdAt: now,
      updatedAt: now,
      sessionId: null,
    };
    await this.store.save(copy);
    await this.reloadSummaries();
    this.log.info('AgentConversation', 'Conversation duplicated', id, copy.id);
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
    const context: ConversationContext = this.context();
    const contextLabel: string | undefined = this.contextLabelOf(context);
    const record: StoredAgentConversation = {
      id,
      contextId: contextIdOf(context),
      title: this.customTitle ?? this.deriveTitle(branch.origin),
      titleIsCustom: this.customTitle !== null,
      agentType: this.agentTypeOf(context),
      ...(contextLabel !== undefined ? { contextLabel } : {}),
      categoryId: this.categoryId,
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
    const contextLabel: string | undefined = this.contextLabelOf(context);
    const record: StoredAgentConversation = {
      id,
      contextId: contextIdOf(context),
      title: this.customTitle ?? this.deriveTitle(items),
      titleIsCustom: this.customTitle !== null,
      agentType: this.agentTypeOf(context),
      ...(contextLabel !== undefined ? { contextLabel } : {}),
      categoryId: this.categoryId,
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
   * Resolves the agent type recorded on the conversations this host creates: the host's explicitly
   * declared type when it provides one, else a type derived from the conversation's context kind.
   * @param context The conversation context.
   * @returns Returns the agent type.
   */
  private agentTypeOf(context: ConversationContext): AgentConversationAgentType {
    return this.declaredAgentType ?? agentTypeFromContextKind(context.kind);
  }

  /**
   * Derives the short secondary-context label shown as a grey chip: the file/folder base name for a
   * file, workspace, or repository context, or undefined for the global bucket (which has no meaningful
   * location).
   * @param context The conversation context.
   * @returns Returns the label, or undefined when there is none.
   */
  private contextLabelOf(context: ConversationContext): string | undefined {
    if (context.kind === 'global' || context.key.length === 0) {
      return undefined;
    }
    const parts: readonly string[] = context.key
      .split(/[\\/]/)
      .filter((part: string): boolean => part.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : undefined;
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
