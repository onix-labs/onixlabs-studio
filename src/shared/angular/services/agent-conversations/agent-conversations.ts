import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  AgentConversationChannel,
  AgentConversationClient,
  AgentConversationSummary,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';

/**
 * Renderer-side client for the agent conversations owned by the main process. It wraps the generic
 * bridge and degrades to a safe no-op (empty list / null) when the bridge is absent (outside
 * Electron), so callers need no environment check.
 */
@Service()
export class AgentConversations implements AgentConversationClient {
  /**
   * Holds the generic IPC bridge, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets a value indicating whether conversation persistence is available (i.e. running in Electron).
   */
  public readonly isAvailable: boolean = this.bridge !== undefined;

  /**
   * Lists the summaries of the conversations stored for a context, newest first.
   * @param contextId The context identifier to list conversations for.
   * @returns Returns the summaries (empty outside Electron).
   */
  public async list(contextId: string): Promise<readonly AgentConversationSummary[]> {
    return (
      (await this.bridge?.invoke<readonly AgentConversationSummary[]>(
        AgentConversationChannel.List,
        contextId,
      )) ?? []
    );
  }

  /**
   * Loads a full conversation by id.
   * @param id The conversation id.
   * @returns Returns the conversation, or null when it does not exist.
   */
  public async load(id: string): Promise<StoredAgentConversation | null> {
    return (
      (await this.bridge?.invoke<StoredAgentConversation | null>(
        AgentConversationChannel.Load,
        id,
      )) ?? null
    );
  }

  /**
   * Persists a conversation, creating or replacing it.
   * @param conversation The conversation to store.
   * @returns Returns the stored summary, or null when it could not be stored.
   */
  public async save(
    conversation: StoredAgentConversation,
  ): Promise<AgentConversationSummary | null> {
    return (
      (await this.bridge?.invoke<AgentConversationSummary | null>(
        AgentConversationChannel.Save,
        conversation,
      )) ?? null
    );
  }

  /**
   * Deletes conversations by id.
   * @param ids The ids to delete.
   */
  public async delete(ids: readonly string[]): Promise<void> {
    await this.bridge?.invoke<void>(AgentConversationChannel.Delete, ids);
  }
}
