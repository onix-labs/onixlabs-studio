import { CppProjectSystem } from './cpp-project-system';
import { DotnetProjectSystem } from './dotnet-project-system';
import { JvmProjectSystem } from './jvm-project-system';
import { NodeProjectSystem } from './node-project-system';
import { ProjectSystemRegistry } from './project-system';
import { PythonProjectSystem } from './python-project-system';
import { RustProjectSystem } from './rust-project-system';

/**
 * Builds a project-system registry seeded with the built-in providers. Registration order is match
 * priority: a root holding both a .NET solution and a package.json models as .NET, a Gradle/Maven root
 * that also carries a package.json (a JVM build with a JS toolchain alongside) models as JVM, a Python
 * root that also carries a package.json (a Python service with a JS front-end) models as Python, and a
 * CMake/Make root that also carries a package.json (a native addon) models as C/C++.
 * @returns Returns the registry.
 */
export function createProjectSystems(): ProjectSystemRegistry {
  const registry: ProjectSystemRegistry = new ProjectSystemRegistry();
  registry.register(new DotnetProjectSystem());
  registry.register(new JvmProjectSystem());
  registry.register(new PythonProjectSystem());
  registry.register(new CppProjectSystem());
  registry.register(new RustProjectSystem());
  registry.register(new NodeProjectSystem());
  return registry;
}

/**
 * The process-wide project-system registry, shared by the language-server layer (which uses it to
 * decide what a structure-aware server opens) and the workspace IPC (which serves the model to the
 * renderer's Solution Explorer). The providers are stateless, so a single shared instance is safe.
 */
export const projectSystems: ProjectSystemRegistry = createProjectSystems();
