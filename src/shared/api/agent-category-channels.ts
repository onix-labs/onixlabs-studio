// Shared contract for user-created conversation categories, between the Electron (back-end) and
// Angular (front-end) processes. Categories are the user's own organisation layer over conversation
// history: a named, optionally-coloured folder a conversation can be filed under (at most one). They
// are stored in the main process's user-data directory, independent of any conversation context, so
// they span every workspace/repository/file. Keep this module platform-neutral (types and constants
// only — no Node or DOM dependencies) so both compilation targets can import it.

/**
 * Names the agent-category IPC channels. The renderer's category client and the main-process
 * {@link import('../electron/ai/agent-category-store').AgentCategoryStore} both name their channel from
 * here, over the generic {@link import('./bridge').Bridge} transport.
 */
export enum AgentCategoryChannel {
  /**
   * Lists every stored category, in the user's chosen order (invoke).
   */
  List = 'agent-category:list',

  /**
   * Persists a category (creating or replacing it) and returns the stored record (invoke). Backs
   * creating a category and renaming or recolouring an existing one.
   */
  Save = 'agent-category:save',

  /**
   * Deletes categories by id (invoke). Deleting a category never deletes the conversations filed under
   * it — the caller clears those conversations' category separately.
   */
  Delete = 'agent-category:delete',
}

/**
 * A user-created conversation category: a named, optionally-coloured folder shown as a collapsible node
 * in the history tree, that conversations can be filed under.
 */
export interface AgentCategory {
  /**
   * Gets the category's unique identifier.
   */
  readonly id: string;

  /**
   * Gets the category's user-chosen display name.
   */
  readonly name: string;

  /**
   * Gets the category's accent colour (a CSS colour string) shown on its folder chip, or absent for the
   * default neutral colour. Reuses the dropdown colour-chip seam.
   */
  readonly color?: string;

  /**
   * Gets the category's position among its siblings (ascending), so the user's ordering is stable.
   */
  readonly sortOrder: number;

  /**
   * Gets when the category was created (epoch milliseconds).
   */
  readonly createdAt: number;
}

/**
 * Defines the renderer-facing category operations, wrapping the channel transport. Implemented by the
 * renderer's `AgentCategories` service.
 */
export interface AgentCategoryClient {
  /**
   * Lists every stored category, in the user's chosen order.
   * @returns Returns the categories.
   */
  list(): Promise<readonly AgentCategory[]>;

  /**
   * Persists a category, creating or replacing it.
   * @param category The category to store.
   * @returns Returns the stored category, or null when it could not be stored.
   */
  save(category: AgentCategory): Promise<AgentCategory | null>;

  /**
   * Deletes categories by id.
   * @param ids The ids to delete.
   */
  delete(ids: readonly string[]): Promise<void>;
}
