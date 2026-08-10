import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { AgentCategory, AgentCategoryChannel } from '@shared/api/agent-category-channels';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { Log } from '@shared/angular/services/log/log';

/**
 * Owns the user's conversation categories in the renderer — the organisation layer over conversation
 * history. A single app-wide service (categories are cross-context, spanning every workspace,
 * repository, and file), it wraps the category IPC channels, holds the reactive {@link categories}
 * list every history tree reads, and mediates creation, renaming/recolouring, reordering, and deletion.
 * Deleting a category clears it from the conversations filed under it (they fall back to uncategorized)
 * but never deletes those conversations. Degrades to an empty, inert registry outside Electron.
 */
@Service()
export class AgentCategories {
  /**
   * Holds the generic IPC bridge, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the conversation client, used to clear a deleted category from its conversations.
   */
  private readonly conversations: AgentConversations = inject(AgentConversations);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the stored categories, in the user's chosen order.
   */
  private readonly categoriesState: WritableSignal<readonly AgentCategory[]> = signal<
    readonly AgentCategory[]
  >([]);

  /**
   * Gets the stored categories, in the user's chosen order.
   */
  public readonly categories: Signal<readonly AgentCategory[]> = this.categoriesState.asReadonly();

  /**
   * Initializes a new instance of the {@link AgentCategories} class, loading the stored categories.
   */
  public constructor() {
    void this.reload();
  }

  /**
   * Reloads the stored categories.
   */
  public async reload(): Promise<void> {
    const categories: readonly AgentCategory[] =
      (await this.bridge?.invoke<readonly AgentCategory[]>(AgentCategoryChannel.List)) ?? [];
    this.categoriesState.set(categories);
  }

  /**
   * Finds a category by id.
   * @param id The category id, or null.
   * @returns Returns the category, or undefined when absent (or when id is null).
   */
  public find(id: string | null | undefined): AgentCategory | undefined {
    return id == null
      ? undefined
      : this.categoriesState().find((category: AgentCategory): boolean => category.id === id);
  }

  /**
   * Creates a new category with the given name (and optional colour), appended after the last one.
   * @param name The category name; a blank name is rejected.
   * @param color The optional accent colour.
   * @returns Returns the created category, or null when the name was blank or the write failed.
   */
  public async create(name: string, color?: string): Promise<AgentCategory | null> {
    const trimmed: string = name.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const category: AgentCategory = {
      id: crypto.randomUUID(),
      name: trimmed,
      ...(color !== undefined ? { color } : {}),
      sortOrder: this.nextSortOrder(),
      createdAt: Date.now(),
    };
    const saved: AgentCategory | null = await this.save(category);
    await this.reload();
    this.log.info('AgentCategories', `Category created '${trimmed}'`, category.id);
    return saved;
  }

  /**
   * Renames and/or recolours an existing category. Passing `color: undefined` clears its colour.
   * @param id The category id.
   * @param patch The fields to change.
   */
  public async update(id: string, patch: { name?: string; color?: string }): Promise<void> {
    const existing: AgentCategory | undefined = this.find(id);
    if (existing === undefined) {
      return;
    }
    const name: string =
      patch.name !== undefined && patch.name.trim().length > 0 ? patch.name.trim() : existing.name;
    const next: AgentCategory = {
      ...existing,
      name,
      ...('color' in patch ? { color: patch.color } : {}),
    };
    await this.save(next);
    await this.reload();
  }

  /**
   * Deletes a category, first clearing it from every conversation filed under it so those conversations
   * fall back to uncategorized. Never deletes a conversation.
   * @param id The category id.
   */
  public async delete(id: string): Promise<void> {
    this.log.info('AgentCategories', 'Category deleted', id);
    await this.conversations.clearCategory(id);
    await this.bridge?.invoke<void>(AgentCategoryChannel.Delete, [id]);
    await this.reload();
  }

  /**
   * Persists a category record through the bridge.
   * @param category The category to store.
   * @returns Returns the stored category, or null.
   */
  private async save(category: AgentCategory): Promise<AgentCategory | null> {
    return (
      (await this.bridge?.invoke<AgentCategory | null>(AgentCategoryChannel.Save, category)) ?? null
    );
  }

  /**
   * Computes the sort order for a new category: one past the current maximum.
   * @returns Returns the next sort order.
   */
  private nextSortOrder(): number {
    return this.categoriesState().reduce(
      (max: number, category: AgentCategory): number => Math.max(max, category.sortOrder + 1),
      0,
    );
  }
}
