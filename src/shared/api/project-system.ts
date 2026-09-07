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
       * Gets the slash-delimited path that addresses this folder within its solution file (for example
       * `/Core/Abstractions`), which is how a folder is named there — not a filesystem path, since the
       * folder stands for no directory.
       *
       * Carried explicitly rather than reassembled from the tree, so an edit addresses the folder the
       * solution file actually declares rather than one inferred from display names.
       */
      readonly logicalPath: string;

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
 * A node in a project's contents tree: either a folder or a file within the project. The tree is the
 * project's *logical* contents (its compile/content items, honouring linked files), which need not
 * match the on-disk layout.
 */
export type ProjectItemNode =
  | {
      /**
       * Identifies a logical folder within the project.
       */
      readonly type: 'folder';

      /**
       * Gets the folder's display name.
       */
      readonly name: string;

      /**
       * Gets the absolute path of the directory the folder stands for, or null when it stands for no
       * directory at all.
       *
       * Nullable rather than optional, so every project system has to answer: most build their trees by
       * walking directories, where the answer is simply the directory they walked. A project's folders
       * are *logical* though, and need not exist on disk — MSBuild `Link` metadata places a file under a
       * folder that was never a directory — so the honest answer is sometimes null. It is never inferred
       * from a descendant file's path, which would invent a plausible-looking wrong directory.
       */
      readonly path: string | null;

      /**
       * Gets the folder's children.
       */
      readonly children: readonly ProjectItemNode[];
    }
  | {
      /**
       * Identifies a file within the project.
       */
      readonly type: 'file';

      /**
       * Gets the file's display name.
       */
      readonly name: string;

      /**
       * Gets the absolute path of the file on disk.
       */
      readonly path: string;
    };

/**
 * A project's logical contents, loaded on demand when its node is expanded.
 */
export interface ProjectItems {
  /**
   * Gets the absolute path of the project file the contents belong to.
   */
  readonly projectPath: string;

  /**
   * Gets the project's logical contents tree.
   */
  readonly tree: readonly ProjectItemNode[];
}

/**
 * An action a project system can perform on a project or solution. `build`/`clean`/`rebuild` are the
 * common compile-time actions; `test`/`publish`/`restore` are declared by the ecosystems that support
 * them. The ribbon renders a control for an action only when the active provider declares it.
 */
export type ProjectAction = 'build' | 'clean' | 'rebuild' | 'test' | 'publish' | 'restore';

/**
 * A named build configuration a provider supports (for example .NET's Debug/Release, Rust's dev/release).
 * The list is provider-supplied; an empty list means the ecosystem has no build-configuration axis.
 */
export interface BuildConfiguration {
  /**
   * Gets the stable identifier of the build configuration.
   */
  readonly id: string;

  /**
   * Gets the display name of the build configuration (for example `Debug`).
   */
  readonly name: string;
}

/**
 * The kind of axis a {@link TargetAxis} represents: a .NET/CPU platform, a Rust/Clang target triple, or
 * a Go GOOS/GOARCH architecture. The kind labels the axis; it does not change how the options render.
 */
export type TargetKind = 'platform' | 'target-triple' | 'arch';

/**
 * A single option on a {@link TargetAxis} (for example `Any CPU`, `x64`, `ARM64`).
 */
export interface TargetOption {
  /**
   * Gets the stable identifier of the target option.
   */
  readonly id: string;

  /**
   * Gets the display name of the target option.
   */
  readonly name: string;
}

/**
 * The provider's target axis — the language-agnostic replacement for the fixed CPU dropdown. A provider
 * whose ecosystem has no target axis (an interpreted language, for example) declares no axis at all, so
 * the ribbon renders no target control rather than an empty one.
 */
export interface TargetAxis {
  /**
   * Gets what the axis represents.
   */
  readonly kind: TargetKind;

  /**
   * Gets the ribbon label for the axis (for example `Platform`).
   */
  readonly label: string;

  /**
   * Gets the selectable target options.
   */
  readonly options: readonly TargetOption[];
}

/**
 * Declares that a provider's projects can be debugged, and which DAP adapter debugs them. Absent (null)
 * until an adapter is provisioned for the ecosystem, so the ribbon's Debug button stays inert.
 */
export interface DebugCapability {
  /**
   * Gets the identifier of the DAP adapter that debugs this provider's projects.
   */
  readonly adapter: string;
}

/**
 * The root-independent capabilities a project system declares, so the ribbon can gate its optional
 * controls from data rather than hard-coded assumptions: which {@link ProjectAction actions} it
 * supports, its build configurations and target axis, and whether (and how) it debugs. Run
 * configurations are not part of this: a project system never infers them from a root.
 */
export interface ProjectCapabilities {
  /**
   * Gets the actions the provider supports (an absent action is not rendered, not greyed — and a
   * group left with no rendered action disappears with them, rather than standing as dead chrome).
   */
  readonly actions: readonly ProjectAction[];

  /**
   * Gets the provider's build configurations, or an empty list when it has no build-configuration axis.
   */
  readonly buildConfigurations: readonly BuildConfiguration[];

  /**
   * Gets the provider's target axis, or null when the ecosystem has none.
   */
  readonly target: TargetAxis | null;

  /**
   * Gets the debug capability, or null when the provider declares no DAP adapter yet.
   */
  readonly debug: DebugCapability | null;

  /**
   * Gets a value indicating whether this model's solution folders can be renamed.
   *
   * Narrowed by the root, not just the ecosystem: .NET can rename a folder in the XML `.slnx` format
   * but not in the classic `.sln`, whose folder nesting it does not reconstruct. False leaves the
   * folder with no context menu at all, which is what every provider without solution folders wants.
   */
  readonly renamesSolutionFolders: boolean;
}

/**
 * Describes the compiled artefact a source file's project produces — what a decoder can read to show
 * what that source became.
 */
export interface CompiledArtifact {
  /**
   * Gets the absolute path of the compiled output (an assembly, or a class file).
   */
  readonly artifactPath: string;

  /**
   * Gets the absolute path of the symbols beside it, or null when there are none. A decoder needs these
   * to report source lines, and their absence is why a release build shows IL without them.
   */
  readonly symbolsPath: string | null;

  /**
   * Gets a value indicating whether the source file is newer than the artefact.
   *
   * Reported rather than acted on: rebuilding because someone opened a panel would be a surprise, and
   * showing stale output as though it were current would be a lie. The caller says so and lets the user
   * decide.
   */
  readonly stale: boolean;
}

/**
 * The outcome of a project-system edit (renaming a solution folder, for example). Deliberately narrow:
 * an edit either took or gives the reason it did not, which is what the caller reports.
 */
export interface ProjectOperationResult {
  /**
   * Gets a value indicating whether the edit succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the reason the edit failed, when it did.
   */
  readonly error?: string;
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

  /**
   * Gets the capabilities in force for this root, so the ribbon can gate its optional controls from
   * data: the producing project system's declared baseline, narrowed where the root itself decides
   * what is possible (a Node package declares only the actions its manifest scripts back).
   */
  readonly capabilities: ProjectCapabilities;
}
