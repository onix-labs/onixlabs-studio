/**
 * Names the package-management IPC channels: resolving the package model (projects and their declared
 * dependencies, with upgrade state) the Package Management panel renders for a workspace root. This is
 * the package capability's slice of the IPC contract: the renderer's package model and the main-process
 * workspace manager name their channels from here, over the generic {@link import('./bridge').Bridge}
 * transport. The model payload types live in {@link import('./package-management')}, which is already
 * platform-neutral.
 */
export enum PackageChannel {
  /**
   * Loads the package model for a workspace root, resolving installed and latest versions (invoke).
   */
  ModelLoad = 'package:model-load',
}
