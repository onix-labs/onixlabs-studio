import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ContainerEngineInfo } from '@shared/api/container-types';
import { ContainerEngineDescriptor } from './container-engine';
import { DiscoveryEnvironment } from './socket-discovery';

/**
 * Holds the paths the stubbed choice store reports as present.
 */
let present: Set<string>;

/**
 * Holds the engine choice the stubbed store reads back, or null when the user has never chosen.
 */
let storedChoice: string | null;

// The module resolves its choice store under the user-data directory, which only Electron can answer
// for, so the application object is stubbed rather than the test being run under Electron. The choice
// store is the only file system this module touches on its own account — where an engine's *socket* is
// comes from an injected discovery environment, and *which* engines exist from an injected catalogue,
// so neither depends on what happens to be installed on the machine running the suite.
vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }));
vi.mock('node:fs', () => ({
  existsSync: (file: string): boolean => present.has(file),
  readFileSync: (): string => JSON.stringify({ engine: storedChoice }),
  writeFileSync: (): void => undefined,
}));

/**
 * The choice store's path, as the module resolves it.
 */
const STORE: string = path.join(tmpdir(), 'container-engine.json');

/**
 * Builds an engine descriptor of the shape a plugin contributes.
 *
 * Studio ships no engine of its own since #596 and #597, so the catalogue a test works against is one
 * it states rather than one it inherits.
 * @param id The engine identifier.
 * @param priority The priority, higher winning by default.
 * @param socket The engine's only socket candidate.
 * @returns Returns the descriptor.
 */
function engine(id: string, priority: number, socket: string): ContainerEngineDescriptor {
  return {
    id,
    displayName: id === 'docker' ? 'Docker' : 'Podman',
    priority,
    cli: `/plugins/${id}/bin/${id}`,
    discovery: {
      hostVariable: id === 'docker' ? 'DOCKER_HOST' : 'CONTAINER_HOST',
      dockerContext: id === 'docker',
      defaults: (): readonly string[] => [socket],
    },
    startCommand: (): string | null => (id === 'docker' ? null : 'podman machine start'),
  };
}

/**
 * The socket the fake catalogue's Docker engine is served on.
 */
const DOCKER_SOCKET: string = '/var/run/docker.sock';

/**
 * The socket the fake catalogue's Podman engine is served on.
 */
const PODMAN_SOCKET: string = '/run/podman/podman.sock';

/**
 * A catalogue with both engines installed, in the priority order the curated index gives them.
 */
const BOTH: readonly ContainerEngineDescriptor[] = [
  engine('docker', 100, DOCKER_SOCKET),
  engine('podman', 50, PODMAN_SOCKET),
];

/**
 * Builds a discovery environment reporting a given set of sockets and no Docker configuration.
 * @param sockets The engine sockets present on the machine.
 * @returns Returns the environment.
 */
function machineWith(sockets: readonly string[]): DiscoveryEnvironment {
  const set: ReadonlySet<string> = new Set<string>(sockets);
  return {
    platform: 'darwin',
    env: {},
    home: '/home/tester',
    exists: (target: string): boolean => set.has(target),
    read: (): string | null => null,
  };
}

/**
 * Prepares the stubbed choice store.
 * @param chosen The engine the user has chosen, or null when they never have.
 */
function chose(chosen: string | null): void {
  present = new Set<string>();
  storedChoice = chosen;
  if (chosen !== null) {
    present.add(STORE);
  }
  vi.resetModules();
}

describe('selectedEngine', () => {
  beforeEach(() => {
    chose(null);
  });

  it('withNothingRunningAndNoChoice_fallsBackToTheHighestPriorityEngine', async () => {
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([]), BOTH)?.id).toBe('docker');
  });

  it('withTheChosenEngineNotRunning_staysWithTheChoiceRatherThanTheDefault', async () => {
    // A Podman user whose machine is stopped has no socket at all, and falling through to the
    // catalogue default told them that *Docker* was not running.
    chose('podman');
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([]), BOTH)?.id).toBe('podman');
  });

  it('withAnEngineRunning_prefersTheRunningEngineOverAStaleChoice', async () => {
    chose('nonexistent');
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([PODMAN_SOCKET]), BOTH)?.id).toBe('podman');
  });

  it('withOnlyPodmanRunning_choosesPodmanWithoutBeingTold', async () => {
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([PODMAN_SOCKET]), BOTH)?.id).toBe('podman');
  });

  it('withNoEngineInstalled_isNullRatherThanTheFirstOfAnEmptyList', async () => {
    // The ordinary state of a fresh Studio since #597: no engine ships, so nothing is selected until
    // the user installs one.
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([]), [])).toBeNull();
  });
});

describe('describeEngines', () => {
  beforeEach(() => {
    chose(null);
  });

  /**
   * Gets one engine's description.
   * @param engines The described engines.
   * @param id The engine to pick out.
   * @returns Returns the description, or undefined.
   */
  function pick(
    engines: readonly ContainerEngineInfo[],
    id: string,
  ): ContainerEngineInfo | undefined {
    return engines.find((entry: ContainerEngineInfo): boolean => entry.id === id);
  }

  it('reportsTheEngineInEffectEvenWhenItsSocketIsAbsent', async () => {
    chose('podman');
    const { describeEngines } = await import('./engine-selection');
    const podman: ContainerEngineInfo | undefined = pick(
      describeEngines(machineWith([]), BOTH),
      'podman',
    );

    expect(podman?.inEffect).toBe(true);
    expect(podman?.available).toBe(false);
  });

  it('reportsAnEngineAsAvailableOnlyWhenDiscoveryFindsItsSocket', async () => {
    const { describeEngines } = await import('./engine-selection');
    const engines: readonly ContainerEngineInfo[] = describeEngines(
      machineWith([DOCKER_SOCKET]),
      BOTH,
    );

    expect(pick(engines, 'docker')?.available).toBe(true);
    expect(pick(engines, 'podman')?.available).toBe(false);
  });

  it('offersAStartCommandForAnEngineTheUserMustStartThemselves', async () => {
    const { describeEngines } = await import('./engine-selection');
    const podman: ContainerEngineInfo | undefined = pick(
      describeEngines(machineWith([]), BOTH),
      'podman',
    );

    expect(podman?.startCommand).toBe('podman machine start');
  });

  it('namesExactlyOneEngineAsInEffect', async () => {
    const { describeEngines } = await import('./engine-selection');
    const engines: readonly ContainerEngineInfo[] = describeEngines(machineWith([]), BOTH);

    expect(engines.filter((entry: ContainerEngineInfo): boolean => entry.inEffect)).toHaveLength(1);
  });

  it('keepsSelectedEngineAndDescribeEnginesAgreeing', async () => {
    const { describeEngines, selectedEngine } = await import('./engine-selection');
    const machine: DiscoveryEnvironment = machineWith([PODMAN_SOCKET]);

    expect(
      pick(describeEngines(machine, BOTH), selectedEngine(machine, BOTH)?.id ?? '')?.inEffect,
    ).toBe(true);
  });

  it('withNoEngineInstalled_describesNothing', async () => {
    const { describeEngines } = await import('./engine-selection');

    expect(describeEngines(machineWith([]), [])).toEqual([]);
  });
});
