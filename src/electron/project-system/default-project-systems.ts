import { DotnetProjectSystem } from './dotnet-project-system';
import { ProjectSystemRegistry } from './project-system';

/**
 * Builds a project-system registry seeded with the built-in providers.
 * @returns Returns the registry.
 */
export function createProjectSystems(): ProjectSystemRegistry {
  const registry: ProjectSystemRegistry = new ProjectSystemRegistry();
  registry.register(new DotnetProjectSystem());
  return registry;
}

/**
 * The process-wide project-system registry, shared by the language-server layer (which uses it to
 * decide what a structure-aware server opens) and the workspace IPC (which serves the model to the
 * renderer's Solution Explorer). The providers are stateless, so a single shared instance is safe.
 */
export const projectSystems: ProjectSystemRegistry = createProjectSystems();
