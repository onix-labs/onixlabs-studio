/**
 * Names the `.studio` persistence IPC channels: loading a workspace's merged studio snapshot, and
 * saving the shared and per-developer files independently. The renderer's studio-configuration service
 * and the main-process studio store name their channels from here, over the generic
 * {@link import('./bridge').Bridge} transport. The payload types live in {@link import('./studio')},
 * which is platform-neutral. Every handler is confined to open workspace roots by the main process, so
 * the renderer cannot read or write `.studio` folders outside the opened workspaces.
 */
export enum StudioChannel {
  /**
   * Loads a workspace root's merged studio snapshot — the shared and user files (invoke).
   */
  Load = 'studio:load',

  /**
   * Writes a workspace root's shared `workspace.json` (invoke).
   */
  SaveWorkspace = 'studio:save-workspace',

  /**
   * Writes a workspace root's per-developer `workspace.user.json` (invoke).
   */
  SaveUser = 'studio:save-user',
}
