/**
 * The logical project model for a workspace root, produced by a project system (for example the .NET
 * solution model). It is deliberately distinct from the filesystem tree: the {@link ProjectModel.tree}
 * reflects how the ecosystem groups projects (solution folders, workspace members), which need not
 * match the on-disk layout. Shared so the renderer's Solution Explorer can render the same model the
 * main process builds.
 */

/**
 * A node in a project model's logical tree: either a grouping folder or a project.
 */
export type ProjectNode =
  | {
      /**
       * Identifies a logical grouping folder (a solution folder, not necessarily a real directory).
       */
      readonly type: 'folder';

      /**
       * Gets the folder's display name.
       */
      readonly name: string;

      /**
       * Gets the folder's children.
       */
      readonly children: readonly ProjectNode[];
    }
  | {
      /**
       * Identifies a project.
       */
      readonly type: 'project';

      /**
       * Gets the project's display name.
       */
      readonly name: string;

      /**
       * Gets the absolute path of the project file.
       */
      readonly path: string;
    };

/**
 * A single project within a project model.
 */
export interface ProjectEntry {
  /**
   * Gets the project's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute path of the project file.
   */
  readonly path: string;
}

/**
 * The solution file backing a model, when one exists.
 */
export interface SolutionFile {
  /**
   * Gets the solution's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute path of the solution file.
   */
  readonly path: string;
}

/**
 * A logical project model for a workspace root.
 */
export interface ProjectModel {
  /**
   * Gets the kind of project system that produced the model (for example `dotnet`).
   */
  readonly kind: string;

  /**
   * Gets the absolute workspace root the model was built for.
   */
  readonly root: string;

  /**
   * Gets the solution file the model is backed by, or null when the model was assembled from loose
   * projects with no solution.
   */
  readonly solution: SolutionFile | null;

  /**
   * Gets every project in the model, flattened — the order projects should be opened in.
   */
  readonly projects: readonly ProjectEntry[];

  /**
   * Gets the logical tree (grouping folders and projects) for display.
   */
  readonly tree: readonly ProjectNode[];
}
