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
   * Loads a single conversation by id, or null when it does not exist (invoke).
   */
  Load = 'agent-conversation:load',

  /**
   * Persists a conversation (creating or replacing it), updates the summary index, and returns the
   * stored summary (invoke).
   */
  Save = 'agent-conversation:save',

  /**
   * Deletes conversations by id (invoke).
   */
  Delete = 'agent-conversation:delete',
}

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
   * Gets the conversation's title (derived from its first user message).
   */
  readonly title: string;

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
   * Gets the conversation's title.
   */
  readonly title: string;

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
   * Deletes conversations by id.
   * @param ids The ids to delete.
   */
  delete(ids: readonly string[]): Promise<void>;
}
