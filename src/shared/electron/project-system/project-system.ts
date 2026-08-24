import { ProjectCapabilities, ProjectItems, ProjectModel } from '@shared/api/project-system';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { logger } from '../logger';

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
   * @param projectPath The absolute path of the project file.
   * @returns Returns the contents, or null when they could not be loaded.
   */
  loadProjectItems?(projectPath: string): Promise<ProjectItems | null>;

  /**
   * Determines whether a project file belongs to this provider (by its manifest shape), so a
   * contents request can be routed to the provider that produced the project. Optional: a provider
   * without it is never matched by project file.
   * @param projectPath The absolute path of the project file.
   * @returns Returns true when this provider owns the project file.
   */
  ownsProject?(projectPath: string): boolean;

  /**
   * Resolves a run configuration into a concrete debug launch target, building the project first where
   * debugging requires a produced artifact (for .NET, compiling and locating the output assembly).
   * Optional: a provider whose debug adapter launches the configuration directly (no build step) need
   * not implement it, in which case the configuration's own program is used.
   * @param configuration The run configuration being launched under the debugger.
   * @param root The absolute workspace root.
   * @returns Returns the resolved target, or a reason it could not be resolved.
   */
  resolveDebugTarget?(configuration: RunConfiguration, root: string): Promise<DebugResolveResult>;
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
