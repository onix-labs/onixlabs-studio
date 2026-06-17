import { ProjectItems, ProjectModel } from '../../shared/project-system';

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
    for (const system of this.systems.values()) {
      if (await system.detect(root)) {
        return system;
      }
    }
    return null;
  }
}
