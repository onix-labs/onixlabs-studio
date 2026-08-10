import { NpmPackageManager } from './npm-package-manager';
import { NuGetPackageManager } from './nuget-package-manager';
import { PackageManagerRegistry } from './package-manager';
import { logger } from '../logger';

/**
 * Builds a package-manager registry seeded with the built-in managers. Registration order is match
 * priority (first match wins), mirroring the project systems: a .NET root that also carries an
 * incidental package.json (a service with a JS front-end) models as NuGet, not npm. Further ecosystems
 * (Cargo, Gradle/Maven) register here as they are added.
 * @returns Returns the registry.
 */
export function createPackageManagers(): PackageManagerRegistry {
  const registry: PackageManagerRegistry = new PackageManagerRegistry();
  registry.register(new NuGetPackageManager());
  registry.register(new NpmPackageManager());
  logger.info('default-package-managers', 'Seeded the package-manager registry with 2 built-in managers.');
  return registry;
}

/**
 * The process-wide package-manager registry, shared by the workspace IPC that serves the package model
 * to the renderer's Package Management panel. The managers are stateless, so a single shared instance
 * is safe.
 */
export const packageManagers: PackageManagerRegistry = createPackageManagers();
