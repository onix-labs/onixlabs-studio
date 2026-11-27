import {
  CompiledArtifact,
  DocumentFormatResult,
  ProjectCapabilities,
  ProjectItems,
  ProjectModel,
  ProjectOperationResult,
} from '@shared/api/project-system';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { logger } from '../logger';

import type { RunToken } from '../process/launch';
/**
 * Says what a project system may do while loading a project's contents.
 */
export interface ProjectLoadOptions {
  /**
   * Gets the folder's run token, or null when the user has not trusted it: a tool runs to answer only
   * with one (#1504).
   */
  readonly token: RunToken | null;
}

/**
 * Understands one ecosystem's notion of a project/solution structure (for example .NET solutions, npm
 * workspaces, Cargo workspaces) and turns a workspace root into a logical {@link ProjectModel}. A
 * provider is deliberately language-server-agnostic: it describes the project structure, and callers
 * (the language-server layer, the Solution Explorer) decide what to do with it.
 */
export interface ProjectSystem {
  /**
   * Gets the kind identifier of the project system (for example `dotnet`).
   */
  readonly kind: string;

  /**
   * Gets the root-independent capabilities this project system declares (its supported actions, build
   * configurations, target axis, and debug adapter). The provider stamps these onto every model it
   * loads — narrowing the actions where the root itself decides which exist, as Node does from its
   * manifest scripts — so the ribbon gates its optional controls from data. Run configurations are not
   * among them: a project system never infers what to run from a root — configurations are authored,
   * not guessed.
   */
  readonly capabilities: ProjectCapabilities;

  /**
   * Determines whether this project system applies to a workspace root (its manifests are present).
   * @param root The absolute workspace root.
   * @returns Returns true when the root is one this provider understands.
   */
  detect(root: string): Promise<boolean>;

  /**
   * Builds the logical project model for a workspace root.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root has nothing this provider can model.
   */
  load(root: string): Promise<ProjectModel | null>;

  /**
   * Loads a single project's logical contents (its files), on demand when its node is expanded.
   * Optional: a provider whose projects have no drillable contents need not implement it.
   *
   * ⛔ A provider that asks a tool for the contents (MSBuild, `go list`, `cargo metadata`) does so only
   * with the folder's run token ({@link ProjectLoadOptions.token}), and otherwise lists the files: the
   * tool reads the project's own configuration, and an untrusted folder runs nothing (#1504).
   * @param projectPath The absolute path of the project file.
   * @param options The folder's run token; absent means no tool may run.
   * @returns Returns the contents, or null when they could not be loaded.
   */
  loadProjectItems?(
    projectPath: string,
    options?: ProjectLoadOptions,
  ): Promise<ProjectItems | null>;

  /**
   * Evaluates several projects' contents together, ahead of the {@link loadProjectItems} call that will
   * follow for each, so a provider whose tool is slow to start pays for it once rather than per project
   * (#1600). The answers are held for those calls, which otherwise behave exactly as before. Optional:
   * a provider with nothing to gain need not implement it.
   *
   * ⛔ Only with a run token, as {@link loadProjectItems}; the caller passes only projects in trusted
   * folders.
   * @param projectPaths The absolute project-file paths.
   * @param options The run token; absent means no tool may run, and nothing is done.
   */
  prefetchProjectItems?(projectPaths: readonly string[], options?: ProjectLoadOptions): void;

  /**
   * Resolves the compiled artefact the project containing a source file produces.
   *
   * **Must not build.** This answers a question a panel asks whenever a file is opened, and building on
   * open would turn browsing a project into compiling it. A project that has not been built yet
   * resolves to null, which the caller shows as "not built" rather than as an error.
   *
   * Optional: a provider whose ecosystem has no compiled artefact need not implement it.
   * @param sourcePath The absolute path of the source file.
   * @param configurationId The selected build configuration, or undefined for the provider's default.
   * @param token The folder's run token: resolving asks the build tool (#1504).
   * @returns Returns the artefact, or null when there is none to point at.
   */
  resolveArtifact?(
    sourcePath: string,
    configurationId: string | undefined,
    token: RunToken,
  ): Promise<CompiledArtifact | null>;

  /**
   * Determines whether a project file belongs to this provider (by its manifest shape), so a
   * contents request can be routed to the provider that produced the project. Optional: a provider
   * without it is never matched by project file.
   * @param projectPath The absolute path of the project file.
   * @returns Returns true when this provider owns the project file.
   */
  ownsProject?(projectPath: string): boolean;

  /**
   * Renames a solution folder within the root's solution file. Optional: a provider whose ecosystem has
   * no solution folders, or whose solution format cannot express a rename, need not implement it — and
   * declares so through {@link ProjectCapabilities.renamesSolutionFolders}, which is what the Solution
   * Explorer gates the command on.
   * @param root The absolute workspace root.
   * @param folderPath The slash-delimited path of the folder to rename.
   * @param name The folder's new display name.
   * @returns Returns the outcome of the rename.
   */
  renameSolutionFolder?(
    root: string,
    folderPath: string,
    name: string,
  ): Promise<ProjectOperationResult>;

  /**
   * Resolves a run configuration into a concrete debug launch target, building the project first where
   * debugging requires a produced artifact (for .NET, compiling and locating the output assembly).
   * Optional: a provider whose debug adapter launches the configuration directly (no build step) need
   * not implement it, in which case the configuration's own program is used.
   * @param configuration The run configuration being launched under the debugger.
   * @param root The absolute workspace root.
   * @param token The folder's run token: resolving may build the project (#1504).
   * @returns Returns the resolved target, or a reason it could not be resolved.
   */
  resolveDebugTarget?(
    configuration: RunConfiguration,
    root: string,
    token: RunToken,
  ): Promise<DebugResolveResult>;

  /**
   * Formats a document's text with the tool its project uses, for a language whose server does not
   * format (#1212). Optional: a provider whose files are formatted by their language server need not
   * implement it.
   * @param filePath The document's absolute path.
   * @param text The document's text.
   * @param root The absolute workspace root holding it.
   * @param token The folder's run token: the formatter may be one the folder ships (#1504).
   * @returns Returns the outcome, or null when the file is not one this provider formats.
   */
  formatDocument?(
    filePath: string,
    text: string,
    root: string,
    token: RunToken,
  ): Promise<DocumentFormatResult | null>;
}

/**
 * Holds the registered project systems and resolves the one that applies to a workspace root. The
 * single seam through which project-structure discovery is reached, so callers never hard-code an
 * ecosystem.
 */
export class ProjectSystemRegistry {
  /**
   * Holds the registered project systems, keyed by kind.
   */
  private readonly systems: Map<string, ProjectSystem> = new Map<string, ProjectSystem>();

  /**
   * Registers a project system, replacing any previously registered under the same kind.
   * @param system The project system to register.
   */
  public register(system: ProjectSystem): void {
    logger.debug('ProjectSystemRegistry', `Registered project system '${system.kind}'.`);
    this.systems.set(system.kind, system);
  }

  /**
   * Gets a registered project system by kind.
   * @param kind The kind identifier.
   * @returns Returns the project system, or undefined when none is registered under that kind.
   */
  public get(kind: string): ProjectSystem | undefined {
    return this.systems.get(kind);
  }

  /**
   * Resolves the first registered project system that applies to a workspace root.
   * @param root The absolute workspace root.
   * @returns Returns the matching project system, or null when none applies.
   */
  public async match(root: string): Promise<ProjectSystem | null> {
    logger.trace('ProjectSystemRegistry', `Matching a project system for '${root}'.`);
    for (const system of this.systems.values()) {
      if (await system.detect(root)) {
        logger.debug(
          'ProjectSystemRegistry',
          `Matched project system '${system.kind}' for '${root}'.`,
        );
        return system;
      }
    }
    logger.debug('ProjectSystemRegistry', `No project system matched '${root}'.`);
    return null;
  }

  /**
   * Resolves the registered project system that owns a project file, so a contents request reaches
   * the provider that produced the project rather than a hard-coded ecosystem.
   * @param projectPath The absolute project-file path.
   * @returns Returns the owning project system, or null when none claims the file.
   */
  public all(): readonly ProjectSystem[] {
    return [...this.systems.values()];
  }

  /**
   * Determines which provider owns a project file.
   * @param projectPath The absolute path of the project file.
   * @returns Returns the provider, or null when none claims it.
   */
  public matchProject(projectPath: string): ProjectSystem | null {
    for (const system of this.systems.values()) {
      if (system.ownsProject?.(projectPath) === true) {
        logger.trace(
          'ProjectSystemRegistry',
          `Project '${projectPath}' owned by project system '${system.kind}'.`,
        );
        return system;
      }
    }
    logger.debug('ProjectSystemRegistry', `No project system owns '${projectPath}'.`);
    return null;
  }
}
