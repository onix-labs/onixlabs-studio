import { ContainerEngineDescriptor, containerEngineCatalogue } from './container-engine';
import { ContainerEngineRegistry, contributedEngines } from './container-engine-registry';

/**
 * Builds a contributed engine descriptor.
 * @param id The engine identifier.
 * @param priority The priority, defaulting to one below Docker's so registration order is what is
 * under test rather than priority.
 * @returns Returns the descriptor.
 */
function engine(id: string, priority: number = 10): ContainerEngineDescriptor {
  return {
    id,
    displayName: id,
    priority,
    cli: `/plugins/${id}/bin/${id}`,
    discovery: {
      hostVariable: 'CONTAINER_HOST',
      dockerContext: false,
      defaults: (): readonly string[] => [`/run/${id}.sock`],
    },
    canLaunch: (): boolean => false,
    startCommand: (): string | null => null,
  };
}

describe('ContainerEngineRegistry', () => {
  it('holdsEnginesInRegistrationOrder', () => {
    const registry: ContainerEngineRegistry = new ContainerEngineRegistry();
    registry.register(engine('one'));
    registry.register(engine('two'));

    expect(registry.all().map((entry: ContainerEngineDescriptor): string => entry.id)).toEqual([
      'one',
      'two',
    ]);
  });

  it('replacesAReRegisteredEngineInPlace', () => {
    // In place, so re-registering cannot change the tie-breaking order between equal priorities.
    const registry: ContainerEngineRegistry = new ContainerEngineRegistry();
    registry.register(engine('one'));
    registry.register(engine('two'));
    registry.register({ ...engine('one'), displayName: 'One, renamed' });

    expect(registry.all().map((entry: ContainerEngineDescriptor): string => entry.id)).toEqual([
      'one',
      'two',
    ]);
    expect(registry.all()[0].displayName).toBe('One, renamed');
  });

  it('unregistersAnEngineSoUninstallingStopsItBeingOffered', () => {
    const registry: ContainerEngineRegistry = new ContainerEngineRegistry();
    registry.register(engine('one'));
    registry.register(engine('two'));
    registry.unregister('one');

    expect(registry.all().map((entry: ContainerEngineDescriptor): string => entry.id)).toEqual([
      'two',
    ]);
  });

  it('replaceAll_swapsTheWholeSetBecauseThatIsWhatAnInstallDoes', () => {
    const registry: ContainerEngineRegistry = new ContainerEngineRegistry();
    registry.register(engine('one'));
    registry.replaceAll([engine('two'), engine('three')]);

    expect(registry.all().map((entry: ContainerEngineDescriptor): string => entry.id)).toEqual([
      'two',
      'three',
    ]);
  });

  it('replaceAll_withNothing_empties', () => {
    const registry: ContainerEngineRegistry = new ContainerEngineRegistry();
    registry.register(engine('one'));
    registry.replaceAll([]);

    expect(registry.all()).toEqual([]);
  });
});

describe('containerEngineCatalogue', () => {
  afterEach(() => {
    contributedEngines.replaceAll([]);
  });

  it('offersTheBuiltInEnginesWhenNothingIsContributed', () => {
    contributedEngines.replaceAll([]);

    expect(
      containerEngineCatalogue().map((entry: ContainerEngineDescriptor): string => entry.id),
    ).toEqual(['docker', 'podman']);
  });

  it('offersContributedEnginesAfterTheBuiltInOnes', () => {
    // After, so installing a plugin cannot change the registration order that breaks ties between
    // engines of equal priority.
    contributedEngines.replaceAll([engine('colima')]);

    expect(
      containerEngineCatalogue().map((entry: ContainerEngineDescriptor): string => entry.id),
    ).toEqual(['docker', 'podman', 'colima']);
  });

  it('dropsAContributedEngineWhenItsPluginIsRemoved', () => {
    contributedEngines.replaceAll([engine('colima')]);
    contributedEngines.replaceAll([]);

    expect(
      containerEngineCatalogue().map((entry: ContainerEngineDescriptor): string => entry.id),
    ).toEqual(['docker', 'podman']);
  });
});
