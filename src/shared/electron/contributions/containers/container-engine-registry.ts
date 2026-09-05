import { logger } from '../../logger';
import type { ContainerEngineDescriptor } from './container-engine';

/**
 * Holds the container engines contributed by installed plugins (#594).
 *
 * Separate from the catalogue that names the built-in engines, and deliberately so: this module is
 * imported *by* `container-engine.ts` rather than the other way round, which is what lets the catalogue
 * include contributed engines without the descriptor module depending on the plugin loader and its
 * whole import graph. The descriptor type is imported for its type only, so nothing here runs at load.
 *
 * Registration order breaks ties between engines of equal priority, and contributed engines are
 * appended after the built-ins, so adding a plugin can never silently displace an engine that was
 * already winning.
 */
export class ContainerEngineRegistry {
  /**
   * Holds the registered engines in registration order.
   */
  private readonly descriptors: ContainerEngineDescriptor[] = [];

  /**
   * Registers an engine, replacing any earlier registration of the same identifier in place so a
   * re-registration cannot change the tie-breaking order.
   * @param descriptor The engine to register.
   */
  public register(descriptor: ContainerEngineDescriptor): void {
    const existing: number = this.descriptors.findIndex(
      (candidate: ContainerEngineDescriptor): boolean => candidate.id === descriptor.id,
    );
    if (existing === -1) {
      this.descriptors.push(descriptor);
      logger.debug('ContainerEngineRegistry', `Registered engine '${descriptor.id}'`);
      return;
    }
    this.descriptors[existing] = descriptor;
    logger.debug('ContainerEngineRegistry', `Replaced engine '${descriptor.id}'`);
  }

  /**
   * Removes an engine, so uninstalling a plugin stops it being offered.
   * @param id The engine identifier.
   */
  public unregister(id: string): void {
    const index: number = this.descriptors.findIndex(
      (candidate: ContainerEngineDescriptor): boolean => candidate.id === id,
    );
    if (index !== -1) {
      this.descriptors.splice(index, 1);
      logger.debug('ContainerEngineRegistry', `Unregistered engine '${id}'`);
    }
  }

  /**
   * Replaces every registered engine at once, which is what an install or uninstall does: the set of
   * contributed engines is recomputed from the installed plugins rather than patched.
   * @param descriptors The engines now contributed.
   */
  public replaceAll(descriptors: readonly ContainerEngineDescriptor[]): void {
    this.descriptors.splice(0, this.descriptors.length, ...descriptors);
    logger.debug(
      'ContainerEngineRegistry',
      `Now holding ${descriptors.length} contributed engine(s)`,
    );
  }

  /**
   * Gets every contributed engine, in registration order.
   * @returns Returns the engines.
   */
  public all(): readonly ContainerEngineDescriptor[] {
    return [...this.descriptors];
  }
}

/**
 * The contributed container engines for this session.
 */
export const contributedEngines: ContainerEngineRegistry = new ContainerEngineRegistry();
