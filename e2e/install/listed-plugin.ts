/**
 * What the gate reads of a plugin from `plugins:list`: the part of the renderer's `PluginSummary` it
 * judges by. Declared here rather than imported, because the gate drives an installed build and must
 * not compile against the source it happens to sit beside.
 */
export interface ListedPlugin {
  /**
   * Gets the plugin's identifier.
   */
  readonly id: string;

  /**
   * Gets its display name.
   */
  readonly name: string;

  /**
   * Gets its state: installed, available, busy or unavailable.
   */
  readonly state: string;

  /**
   * Gets the note explaining the state, or null.
   */
  readonly detail: string | null;

  /**
   * Gets the version the catalogue offers.
   */
  readonly version: string;

  /**
   * Gets the version on disk, or null when not installed.
   */
  readonly installedVersion: string | null;
}
