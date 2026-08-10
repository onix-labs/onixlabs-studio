import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentCategory, AgentCategoryChannel } from '@shared/api/agent-category-channels';
import { logger } from '../logger';

/**
 * The directory (under userData) the categories file lives in — shared with the conversations it
 * organises.
 */
const STORE_DIR: string = 'agent-conversations';

/**
 * The file name holding the category registry.
 */
const CATEGORIES_FILE: string = 'categories.json';

/**
 * Owns the user's conversation categories in the main process, persisted as one JSON file
 * (`categories.json`) under `userData/agent-conversations`. Categories are the user's own organisation
 * layer over history — independent of any conversation context — so there is a single flat registry
 * rather than a per-context one. Every read degrades gracefully (empty list) and every write is
 * best-effort, so a corrupt or unwritable store can never crash the app or the renderer.
 */
export class AgentCategoryStore {
  /**
   * Registers the category IPC handlers.
   */
  public register(): void {
    logger.info('AgentCategoryStore', 'Registering category IPC handlers');
    ipcMain.handle(AgentCategoryChannel.List, (): readonly AgentCategory[] => this.list());
    ipcMain.handle(
      AgentCategoryChannel.Save,
      (_event: IpcMainInvokeEvent, value: unknown): AgentCategory | null => this.save(value),
    );
    ipcMain.handle(AgentCategoryChannel.Delete, (_event: IpcMainInvokeEvent, ids: unknown): void =>
      this.delete(ids),
    );
  }

  /**
   * Lists every stored category, ordered by the user's sort order then creation time.
   * @returns Returns the categories.
   */
  private list(): readonly AgentCategory[] {
    return this.read()
      .slice()
      .sort(
        (a: AgentCategory, b: AgentCategory): number =>
          a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
      );
  }

  /**
   * Persists a category (creating or replacing it by id).
   * @param value The category to store.
   * @returns Returns the stored category, or null when the input was malformed or the write failed.
   */
  private save(value: unknown): AgentCategory | null {
    if (!this.isCategory(value)) {
      return null;
    }
    logger.info('AgentCategoryStore.save', `Saving category ${value.id}`);
    const others: readonly AgentCategory[] = this.read().filter(
      (existing: AgentCategory): boolean => existing.id !== value.id,
    );
    return this.write([...others, value]) ? value : null;
  }

  /**
   * Deletes categories by id. Conversations filed under them are cleared separately by the caller.
   * @param ids The ids to delete.
   */
  private delete(ids: unknown): void {
    if (!Array.isArray(ids)) {
      return;
    }
    const remove: Set<string> = new Set<string>(
      ids.filter((id: unknown): id is string => typeof id === 'string'),
    );
    if (remove.size === 0) {
      return;
    }
    logger.info('AgentCategoryStore.delete', `Deleting ${remove.size} category/categories`);
    this.write(this.read().filter((category: AgentCategory): boolean => !remove.has(category.id)));
  }

  /**
   * Reads and validates the categories file, returning an empty list on any failure.
   * @returns Returns the stored categories.
   */
  private read(): readonly AgentCategory[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(this.dir(), CATEGORIES_FILE), 'utf8'));
      return Array.isArray(parsed)
        ? parsed.filter((entry: unknown): entry is AgentCategory => this.isCategory(entry))
        : [];
    } catch (error: unknown) {
      logger.debug('AgentCategoryStore.read', 'No readable categories file', error);
      return [];
    }
  }

  /**
   * Writes the categories file. Best-effort.
   * @param categories The categories to persist.
   * @returns Returns true when the write succeeded.
   */
  private write(categories: readonly AgentCategory[]): boolean {
    try {
      mkdirSync(this.dir(), { recursive: true });
      writeFileSync(join(this.dir(), CATEGORIES_FILE), JSON.stringify(categories), {
        encoding: 'utf8',
        mode: 0o600,
      });
      return true;
    } catch (error: unknown) {
      logger.error('AgentCategoryStore.write', 'Failed to persist categories', error);
      return false;
    }
  }

  /**
   * Determines whether a value is a well-formed category.
   * @param value The value to test.
   * @returns Returns true when it is a category.
   */
  private isCategory(value: unknown): value is AgentCategory {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return (
      typeof record['id'] === 'string' &&
      record['id'].length > 0 &&
      typeof record['name'] === 'string' &&
      typeof record['sortOrder'] === 'number' &&
      typeof record['createdAt'] === 'number' &&
      (record['color'] === undefined || typeof record['color'] === 'string')
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
