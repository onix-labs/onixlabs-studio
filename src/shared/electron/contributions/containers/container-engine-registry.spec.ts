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

  it('offersNothingWhenNoEngineIsInstalled', () => {
    // Studio ships no engine of its own since #596 and #597: an empty catalogue is the delivery model
    // working, not a gap in it, and the Containers surface turns it into an offer to install.
    contributedEngines.replaceAll([]);

    expect(containerEngineCatalogue()).toEqual([]);
  });

  it('offersTheContributedEnginesInRegistrationOrder', () => {
    contributedEngines.replaceAll([engine('docker', 100), engine('colima', 10)]);

    expect(
      containerEngineCatalogue().map((entry: ContainerEngineDescriptor): string => entry.id),
    ).toEqual(['docker', 'colima']);
  });

  it('dropsAContributedEngineWhenItsPluginIsRemoved', () => {
    contributedEngines.replaceAll([engine('colima')]);
    contributedEngines.replaceAll([]);

    expect(containerEngineCatalogue()).toEqual([]);
  });
});
