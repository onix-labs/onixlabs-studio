/**
 * Names the project-system IPC channels: resolving the logical project model (solution and projects)
 * the Solution Explorer renders for a workspace root. This is the project capability's slice of the
 * IPC contract: the renderer's solution model and the main-process workspace manager name their
 * channels from here, over the generic {@link import('./bridge').Bridge} transport. The model and item
 * payload types live in {@link import('../project-system')}, which is already platform-neutral.
 */
export enum ProjectChannel {
  /**
   * Loads the logical project model for a workspace root (invoke).
   */
  ModelLoad = 'project:model-load',

  /**
   * Loads a single project's logical contents, on demand when its node is expanded (invoke).
   */
  ItemsLoad = 'project:items-load',

  /**
   * Renames a solution folder within a root's solution file (invoke).
   */
  SolutionFolderRename = 'project:solution-folder-rename',

  /**
   * Resolves the compiled artefact a source file's project produces, without building it (invoke).
   * Answers null when the file belongs to no project this build understands, or when nothing has been
   * built yet.
   */
  ArtifactResolve = 'project:artifact-resolve',
}
