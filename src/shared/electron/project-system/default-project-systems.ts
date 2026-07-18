import { DotnetProjectSystem } from './dotnet-project-system';
import { JvmProjectSystem } from './jvm-project-system';
import { NodeProjectSystem } from './node-project-system';
import { ProjectSystemRegistry } from './project-system';

/**
 * Builds a project-system registry seeded with the built-in providers. Registration order is match
 * priority: a root holding both a .NET solution and a package.json models as .NET, and a Gradle/Maven
 * root that also carries a package.json (a JVM build with a JS toolchain alongside) models as JVM.
 * @returns Returns the registry.
 */
export function createProjectSystems(): ProjectSystemRegistry {
  const registry: ProjectSystemRegistry = new ProjectSystemRegistry();
  registry.register(new DotnetProjectSystem());
  registry.register(new JvmProjectSystem());
  registry.register(new NodeProjectSystem());
  return registry;
}

/**
 * The process-wide project-system registry, shared by the language-server layer (which uses it to
 * decide what a structure-aware server opens) and the workspace IPC (which serves the model to the
 * renderer's Solution Explorer). The providers are stateless, so a single shared instance is safe.
 */
export const projectSystems: ProjectSystemRegistry = createProjectSystems();
