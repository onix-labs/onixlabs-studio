// Shared contract for persisted agent conversations, between the Electron (back-end) and Angular
// (front-end) processes. Conversations are stored in the main process's user-data directory, scoped to
// a context (a workspace, repository, file, or the global "new agent"); the renderer references a
// conversation only by its id and lists them by context. Keep this module platform-neutral (types and
// constants only — no Node or DOM dependencies) so both compilation targets can import it.

/**
 * Names the agent-conversation IPC channels. The renderer's conversation client and the main-process
 * {@link import('../electron/ai/agent-conversation-store').AgentConversationStore} both name their
 * channel from here, over the generic {@link import('./bridge').Bridge} transport.
 */
export enum AgentConversationChannel {
  /**
   * Lists the summaries of the conversations stored for a context, newest first (invoke).
   */
  List = 'agent-conversation:list',

  /**
   * Lists the summaries of every stored conversation, across all contexts, newest first (invoke). The
   * redesigned history tree shows all conversations regardless of the agent that created them, so it
   * lists through this channel rather than the context-scoped {@link AgentConversationChannel.List}.
   */
  ListAll = 'agent-conversation:list-all',

  /**
   * Loads a single conversation by id, or null when it does not exist (invoke).
   */
  Load = 'agent-conversation:load',

  /**
   * Persists a conversation (creating or replacing it), updates the summary index, and returns the
   * stored summary (invoke).
   */
  Save = 'agent-conversation:save',

  /**
   * Patches a single conversation's mutable metadata (title, custom-title flag, category) in place,
   * without rewriting its transcript, and returns the updated summary (invoke). Backs rename, filing
   * under a category, and removing from a category.
   */
  UpdateMeta = 'agent-conversation:update-meta',

  /**
   * Clears the given category from every conversation filed under it, returning nothing (invoke). Used
   * when a category is deleted so its conversations fall back to uncategorized rather than dangling.
   */
  ClearCategory = 'agent-conversation:clear-category',

  /**
   * Deletes conversations by id (invoke).
   */
  Delete = 'agent-conversation:delete',
}

/**
 * Identifies the kind of agent that created a conversation, shown as its primary metadata chip and
 * used by the history filter. This is informational and filterable — it never determines where a
 * conversation appears (every conversation is visible under All Conversations regardless of type). The
 * set is open-ended by design so new specialized agents can be added without fragmenting history.
 */
export type AgentConversationAgentType =
  | 'agent'
  | 'code'
  | 'workspace'
  | 'terminal'
  | 'review'
  | 'search';

/**
 * Identifies the kind of context a conversation is associated with. `global` is the standalone "new
 * agent" bucket, which is not tied to a workspace, repository, or file.
 */
export type ConversationContextKind = 'global' | 'workspace' | 'repository' | 'file';

/**
 * Describes the context a conversation belongs to: a kind plus the stable key that identifies the
 * specific workspace/repository/file (an absolute path). The `global` context uses an empty key.
 */
export interface ConversationContext {
  /**
   * Gets the context kind.
   */
  readonly kind: ConversationContextKind;

  /**
   * Gets the stable key of the context (an absolute path for workspace/repository/file; empty for
   * global).
   */
  readonly key: string;
}

/**
 * Builds the opaque, stable identifier string for a context, used to scope and filter stored
 * conversations. Kept here so the main and renderer processes derive it identically.
 * @param context The conversation context.
 * @returns Returns the context identifier (`<kind>:<key>`).
 */
export function contextIdOf(context: ConversationContext): string {
  return `${context.kind}:${context.key}`;
}

/**
 * The lightweight summary of a stored conversation shown in the conversation list (the index entry).
 */
export interface AgentConversationSummary {
  /**
   * Gets the conversation's unique identifier.
   */
  readonly id: string;

  /**
   * Gets the identifier of the context the conversation belongs to (see {@link contextIdOf}).
   */
  readonly contextId: string;

  /**
   * Gets the conversation's title: the user's custom title when {@link titleIsCustom} is set, else one
   * derived from its first user message.
   */
  readonly title: string;

  /**
   * Gets a value indicating whether {@link title} is a user-chosen custom title (which survives new
   * messages) rather than one derived from the transcript. Absent on conversations saved before rename
   * existed, treated as false.
   */
  readonly titleIsCustom?: boolean;

  /**
   * Gets the kind of agent that created the conversation, its primary metadata chip. Absent on
   * conversations saved before agent-type was recorded, in which case a fallback is derived from the
   * context kind.
   */
  readonly agentType?: AgentConversationAgentType;

  /**
   * Gets the short secondary-context label shown as a grey chip beside the agent-type chip (a file
   * name, workspace or repository folder name), or absent when there is no meaningful context (the
   * global bucket). Derived from the context at save time.
   */
  readonly contextLabel?: string;

  /**
   * Gets the id of the user-created category the conversation is filed under, or null/absent when it is
   * uncategorized. A conversation is filed under at most one category; it always remains visible under
   * All Conversations regardless.
   */
  readonly categoryId?: string | null;

  /**
   * Gets the number of user/assistant messages in the conversation.
   */
  readonly messageCount: number;

  /**
   * Gets when the conversation was first created (epoch milliseconds).
   */
  readonly createdAt: number;

  /**
   * Gets when the conversation was last updated (epoch milliseconds).
   */
  readonly updatedAt: number;
}

/**
 * A full stored conversation: its summary fields plus the provider/model it ran under and the
 * serialized transcript items. The items are opaque to the main process (the renderer's `AgentItem[]`
 * serialized as JSON); the store persists and returns them verbatim.
 */
export interface StoredAgentConversation {
  /**
   * Gets the conversation's unique identifier.
   */
  readonly id: string;

  /**
   * Gets the identifier of the context the conversation belongs to.
   */
  readonly contextId: string;

  /**
   * Gets the conversation's title (custom when {@link titleIsCustom}, else derived).
   */
  readonly title: string;

  /**
   * Gets a value indicating whether {@link title} is a user-chosen custom title. See the summary's
   * field of the same name.
   */
  readonly titleIsCustom?: boolean;

  /**
   * Gets the kind of agent that created the conversation. See the summary's field of the same name.
   */
  readonly agentType?: AgentConversationAgentType;

  /**
   * Gets the short secondary-context label. See the summary's field of the same name.
   */
  readonly contextLabel?: string;

  /**
   * Gets the id of the category the conversation is filed under, or null/absent when uncategorized.
   */
  readonly categoryId?: string | null;

  /**
   * Gets the provider the conversation last ran under.
   */
  readonly provider: string;

  /**
   * Gets the model the conversation last ran under.
   */
  readonly model: string;

  /**
   * Gets when the conversation was first created (epoch milliseconds).
   */
  readonly createdAt: number;

  /**
   * Gets when the conversation was last updated (epoch milliseconds).
   */
  readonly updatedAt: number;

  /**
   * Gets the number of user/assistant messages in the conversation.
   */
  readonly messageCount: number;

  /**
   * Gets the serialized transcript items (the renderer's `AgentItem[]`, opaque here).
   */
  readonly items: readonly unknown[];

  /**
   * Gets the provider session to resume so a reopened conversation keeps its memory, or null/absent
   * when it has no session (e.g. an older conversation saved before session continuation, or one that
   * never ran).
   */
  readonly sessionId?: string | null;

  /**
   * Gets the texts of the messages that were still queued (sent while a run executed, awaiting
   * dispatch) when the conversation was saved; absent when nothing was queued.
   */
  readonly queue?: readonly string[];
}

/**
 * A patch to a single conversation's mutable metadata, applied in place by
 * {@link AgentConversationChannel.UpdateMeta} without rewriting the transcript. Only the present fields
 * are changed. Setting `title` also sets `titleIsCustom` true; setting `categoryId` to null clears the
 * category.
 */
export interface AgentConversationMetaPatch {
  /**
   * Gets the id of the conversation to patch.
   */
  readonly id: string;

  /**
   * Gets the new custom title, or omitted to leave the title unchanged.
   */
  readonly title?: string;

  /**
   * Gets the new category id (or null to clear it), or omitted to leave the category unchanged.
   */
  readonly categoryId?: string | null;
}

/**
 * Defines the renderer-facing conversation operations, wrapping the channel transport. Implemented by
 * the renderer's `AgentConversations` service.
 */
export interface AgentConversationClient {
  /**
   * Lists the summaries of the conversations stored for a context, newest first.
   * @param contextId The context identifier to list conversations for.
   * @returns Returns the summaries.
   */
  list(contextId: string): Promise<readonly AgentConversationSummary[]>;

  /**
   * Lists the summaries of every stored conversation, across all contexts, newest first.
   * @returns Returns the summaries.
   */
  listAll(): Promise<readonly AgentConversationSummary[]>;

  /**
   * Loads a full conversation by id.
   * @param id The conversation id.
   * @returns Returns the conversation, or null when it does not exist.
   */
  load(id: string): Promise<StoredAgentConversation | null>;

  /**
   * Persists a conversation, creating or replacing it.
   * @param conversation The conversation to store.
   * @returns Returns the stored summary, or null when it could not be stored.
   */
  save(conversation: StoredAgentConversation): Promise<AgentConversationSummary | null>;

  /**
   * Patches a single conversation's metadata (title, category) in place.
   * @param patch The metadata patch.
   * @returns Returns the updated summary, or null when the conversation does not exist.
   */
  updateMeta(patch: AgentConversationMetaPatch): Promise<AgentConversationSummary | null>;

  /**
   * Clears the given category from every conversation filed under it.
   * @param categoryId The category id to clear.
   */
  clearCategory(categoryId: string): Promise<void>;

  /**
   * Deletes conversations by id.
   * @param ids The ids to delete.
   */
  delete(ids: readonly string[]): Promise<void>;
}
