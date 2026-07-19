import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentConversationChannel,
  AgentConversationMetaPatch,
  AgentConversationSummary,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';

/**
 * Strips any character that could escape the store directory or be filesystem-unsafe from a
 * conversation id used as a file name.
 */
const UNSAFE_ID_CHARS: RegExp = /[^a-zA-Z0-9-]/g;

/**
 * The directory (under userData) all conversation files live in.
 */
const STORE_DIR: string = 'agent-conversations';

/**
 * The index file name holding the lightweight summaries.
 */
const INDEX_FILE: string = 'index.json';

/**
 * Owns the user's agent conversations in the main process. Each conversation is one JSON file
 * (`<id>.json`) under `userData/agent-conversations`, with a summary index (`index.json`) so listing a
 * context does not read every body. Conversations are scoped to a context (`<kind>:<key>`) — a
 * workspace, repository, file, or the global "new agent" bucket — and listing filters the index by
 * that context. Every read degrades gracefully (empty list / null) and every write is best-effort, so
 * a corrupt or unwritable store can never crash the app or the renderer.
 */
export class AgentConversationStore {
  /**
   * Registers the conversation IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      AgentConversationChannel.List,
      (_event: IpcMainInvokeEvent, contextId: unknown): readonly AgentConversationSummary[] =>
        this.list(contextId),
    );
    ipcMain.handle(
      AgentConversationChannel.ListAll,
      (): readonly AgentConversationSummary[] => this.listAll(),
    );
    ipcMain.handle(
      AgentConversationChannel.Load,
      (_event: IpcMainInvokeEvent, id: unknown): StoredAgentConversation | null => this.load(id),
    );
    ipcMain.handle(
      AgentConversationChannel.Save,
      (_event: IpcMainInvokeEvent, value: unknown): AgentConversationSummary | null =>
        this.save(value),
    );
    ipcMain.handle(
      AgentConversationChannel.UpdateMeta,
      (_event: IpcMainInvokeEvent, patch: unknown): AgentConversationSummary | null =>
        this.updateMeta(patch),
    );
    ipcMain.handle(
      AgentConversationChannel.ClearCategory,
      (_event: IpcMainInvokeEvent, categoryId: unknown): void => this.clearCategory(categoryId),
    );
    ipcMain.handle(
      AgentConversationChannel.Delete,
      (_event: IpcMainInvokeEvent, ids: unknown): void => this.delete(ids),
    );
  }

  /**
   * Lists the summaries stored for a context, newest first.
   * @param contextId The context identifier to filter by.
   * @returns Returns the matching summaries.
   */
  private list(contextId: unknown): readonly AgentConversationSummary[] {
    if (typeof contextId !== 'string') {
      return [];
    }
    return this.readIndex()
      .filter((summary: AgentConversationSummary): boolean => summary.contextId === contextId)
      .sort(
        (a: AgentConversationSummary, b: AgentConversationSummary): number =>
          b.updatedAt - a.updatedAt,
      );
  }

  /**
   * Lists every stored summary, across all contexts, newest first. Backs the history tree, which shows
   * all conversations regardless of the agent that created them.
   * @returns Returns all summaries.
   */
  private listAll(): readonly AgentConversationSummary[] {
    return this.readIndex()
      .slice()
      .sort(
        (a: AgentConversationSummary, b: AgentConversationSummary): number =>
          b.updatedAt - a.updatedAt,
      );
  }

  /**
   * Loads a full conversation by id.
   * @param id The conversation id.
   * @returns Returns the conversation, or null when it does not exist or is malformed.
   */
  private load(id: unknown): StoredAgentConversation | null {
    const safeId: string | null = this.safeId(id);
    if (safeId === null) {
      return null;
    }
    try {
      const file: string = join(this.dir(), `${safeId}.json`);
      if (!existsSync(file)) {
        return null;
      }
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      return this.isConversation(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Persists a conversation (creating or replacing it) and updates the summary index.
   * @param value The conversation to store.
   * @returns Returns the stored summary, or null when the input was malformed or the write failed.
   */
  private save(value: unknown): AgentConversationSummary | null {
    if (!this.isConversation(value)) {
      return null;
    }
    const safeId: string | null = this.safeId(value.id);
    if (safeId === null) {
      return null;
    }
    try {
      mkdirSync(this.dir(), { recursive: true });
      writeFileSync(join(this.dir(), `${safeId}.json`), JSON.stringify(value), {
        encoding: 'utf8',
        mode: 0o600,
      });
      const summary: AgentConversationSummary = this.summaryOf(value);
      const others: readonly AgentConversationSummary[] = this.readIndex().filter(
        (existing: AgentConversationSummary): boolean => existing.id !== value.id,
      );
      this.writeIndex([summary, ...others]);
      return summary;
    } catch {
      return null;
    }
  }

  /**
   * Patches a single conversation's mutable metadata (title, custom-title flag, category) in place,
   * rewriting its file and index entry without touching its transcript.
   * @param patch The metadata patch.
   * @returns Returns the updated summary, or null when the conversation is absent or the patch failed.
   */
  private updateMeta(patch: unknown): AgentConversationSummary | null {
    if (typeof patch !== 'object' || patch === null) {
      return null;
    }
    const { id, title, categoryId } = patch as Partial<AgentConversationMetaPatch>;
    const record: StoredAgentConversation | null = this.load(id);
    if (record === null) {
      return null;
    }
    const next: StoredAgentConversation = {
      ...record,
      ...(typeof title === 'string' ? { title, titleIsCustom: true } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      updatedAt: record.updatedAt,
    };
    return this.save(next);
  }

  /**
   * Clears the given category from every conversation filed under it, rewriting each affected file and
   * the index. Never deletes a conversation.
   * @param categoryId The category id to clear.
   */
  private clearCategory(categoryId: unknown): void {
    if (typeof categoryId !== 'string' || categoryId.length === 0) {
      return;
    }
    for (const summary of this.readIndex()) {
      if (summary.categoryId === categoryId) {
        this.updateMeta({ id: summary.id, categoryId: null });
      }
    }
  }

  /**
   * Builds the lightweight index summary from a full conversation, carrying only the metadata fields
   * that are present so the index stays compact.
   * @param value The full conversation.
   * @returns Returns the summary.
   */
  private summaryOf(value: StoredAgentConversation): AgentConversationSummary {
    return {
      id: value.id,
      contextId: value.contextId,
      title: value.title,
      messageCount: value.messageCount,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      ...(value.titleIsCustom ? { titleIsCustom: true } : {}),
      ...(value.agentType !== undefined ? { agentType: value.agentType } : {}),
      ...(value.contextLabel !== undefined ? { contextLabel: value.contextLabel } : {}),
      ...(value.categoryId !== undefined && value.categoryId !== null
        ? { categoryId: value.categoryId }
        : {}),
    };
  }

  /**
   * Deletes conversations by id, removing their bodies and index entries.
   * @param ids The ids to delete.
   */
  private delete(ids: unknown): void {
    if (!Array.isArray(ids)) {
      return;
    }
    const safeIds: string[] = ids
      .map((id: unknown): string | null => this.safeId(id))
      .filter((id: string | null): id is string => id !== null);
    if (safeIds.length === 0) {
      return;
    }
    const remove: Set<string> = new Set<string>(safeIds);
    for (const id of safeIds) {
      try {
        rmSync(join(this.dir(), `${id}.json`), { force: true });
      } catch {
        // Best-effort delete; ignore failures.
      }
    }
    this.writeIndex(
      this.readIndex().filter(
        (summary: AgentConversationSummary): boolean => !remove.has(summary.id),
      ),
    );
  }

  /**
   * Reads and validates the summary index, returning an empty list on any failure.
   * @returns Returns the stored summaries.
   */
  private readIndex(): readonly AgentConversationSummary[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(this.dir(), INDEX_FILE), 'utf8'));
      return Array.isArray(parsed)
        ? parsed.filter((entry: unknown): entry is AgentConversationSummary =>
            this.isSummary(entry),
          )
        : [];
    } catch {
      return [];
    }
  }

  /**
   * Writes the summary index. Best-effort.
   * @param summaries The summaries to persist.
   */
  private writeIndex(summaries: readonly AgentConversationSummary[]): void {
    try {
      mkdirSync(this.dir(), { recursive: true });
      writeFileSync(join(this.dir(), INDEX_FILE), JSON.stringify(summaries), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      // Persistence is best-effort.
    }
  }

  /**
   * Validates an id and returns a filesystem-safe form, or null when it is absent or would be altered
   * by sanitization (rejecting any traversal or unsafe characters rather than silently rewriting).
   * @param id The candidate id.
   * @returns Returns the safe id, or null.
   */
  private safeId(id: unknown): string | null {
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    const safe: string = id.replace(UNSAFE_ID_CHARS, '');
    return safe.length > 0 && safe === id ? safe : null;
  }

  /**
   * Determines whether a value is a well-formed summary index entry.
   * @param value The value to test.
   * @returns Returns true when it is a summary.
   */
  private isSummary(value: unknown): value is AgentConversationSummary {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return (
      typeof record['id'] === 'string' &&
      typeof record['contextId'] === 'string' &&
      typeof record['title'] === 'string' &&
      typeof record['messageCount'] === 'number' &&
      typeof record['createdAt'] === 'number' &&
      typeof record['updatedAt'] === 'number'
    );
  }

  /**
   * Determines whether a value is a well-formed stored conversation.
   * @param value The value to test.
   * @returns Returns true when it is a conversation.
   */
  private isConversation(value: unknown): value is StoredAgentConversation {
    if (!this.isSummary(value)) {
      return false;
    }
    const record: Record<string, unknown> = value as unknown as Record<string, unknown>;
    return (
      typeof record['provider'] === 'string' &&
      typeof record['model'] === 'string' &&
      Array.isArray(record['items'])
    );
  }

  /**
   * Gets the store directory under userData.
   * @returns Returns the absolute directory path.
   */
  private dir(): string {
    return join(app.getPath('userData'), STORE_DIR);
  }
}
