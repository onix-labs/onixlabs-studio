import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ContainerEngineInfo } from '@shared/api/container-types';
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
// comes from an injected discovery environment, so those rules are exercised without any mocking at
// all in `socket-discovery.spec.ts`.
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
 * The Docker socket on the platforms the suite runs on.
 */
const DOCKER_SOCKET: string = '/var/run/docker.sock';

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

  it('withNothingInstalledAndNoChoice_fallsBackToTheDefaultEngine', async () => {
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([]))?.id).toBe('docker');
  });

  it('withTheChosenEngineNotRunning_staysWithTheChoiceRatherThanTheDefault', async () => {
    // A Podman user whose machine is stopped has no socket at all, and falling through to the
    // catalogue default told them that *Docker* was not running.
    chose('podman');
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([]))?.id).toBe('podman');
  });

  it('withAnEngineRunning_prefersTheRunningEngineOverAStaleChoice', async () => {
    chose('nonexistent');
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([DOCKER_SOCKET]))?.id).toBe('docker');
  });

  it('withOnlyPodmanRunning_choosesPodmanWithoutBeingTold', async () => {
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith(['/run/podman/podman.sock']))?.id).toBe('podman');
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
    return engines.find((engine: ContainerEngineInfo): boolean => engine.id === id);
  }

  it('reportsTheEngineInEffectEvenWhenItsSocketIsAbsent', async () => {
    chose('podman');
    const { describeEngines } = await import('./engine-selection');
    const podman: ContainerEngineInfo | undefined = pick(
      describeEngines(machineWith([])),
      'podman',
    );

    expect(podman?.inEffect).toBe(true);
    expect(podman?.available).toBe(false);
  });

  it('reportsAnEngineAsAvailableOnlyWhenDiscoveryFindsItsSocket', async () => {
    const { describeEngines } = await import('./engine-selection');
    const engines: readonly ContainerEngineInfo[] = describeEngines(machineWith([DOCKER_SOCKET]));

    expect(pick(engines, 'docker')?.available).toBe(true);
    expect(pick(engines, 'podman')?.available).toBe(false);
  });

  it('offersAStartCommandForAnEngineTheApplicationCannotLaunch', async () => {
    const { describeEngines } = await import('./engine-selection');
    const podman: ContainerEngineInfo | undefined = pick(
      describeEngines(machineWith([])),
      'podman',
    );

    expect(podman?.canLaunch).toBe(false);
    expect(podman?.startCommand).not.toBeNull();
  });

  it('offersNoStartCommandForAnEngineTheApplicationLaunchesItself', async () => {
    const { describeEngines } = await import('./engine-selection');
    const docker: ContainerEngineInfo | undefined = pick(
      describeEngines(machineWith([])),
      'docker',
    );

    expect(docker?.startCommand).toBeNull();
  });

  it('namesExactlyOneEngineAsInEffect', async () => {
    const { describeEngines } = await import('./engine-selection');
    const engines: readonly ContainerEngineInfo[] = describeEngines(machineWith([]));

    expect(engines.filter((engine: ContainerEngineInfo): boolean => engine.inEffect)).toHaveLength(
      1,
    );
  });

  it('keepsSelectedEngineAndDescribeEnginesAgreeing', async () => {
    const { describeEngines, selectedEngine } = await import('./engine-selection');
    const machine: DiscoveryEnvironment = machineWith(['/run/podman/podman.sock']);

    expect(pick(describeEngines(machine), selectedEngine(machine)?.id ?? '')?.inEffect).toBe(true);
  });
});

describe('with no engine installed at all', () => {
  // The state #596 and #597 create by moving the built-in engines out of core. It cannot be reached
  // while Docker and Podman are compiled in, so the catalogue is passed in empty — and it is passed
  // rather than mocked because the Angular unit-test system refuses `vi.mock` for relative imports,
  // which is a good reason to inject what varies instead of reaching around the module system.
  beforeEach(() => {
    chose(null);
  });

  it('selectedEngine_isNullRatherThanTheFirstOfAnEmptyList', async () => {
    const { selectedEngine } = await import('./engine-selection');

    expect(selectedEngine(machineWith([]), [])).toBeNull();
  });

  it('describeEngines_describesNothing', async () => {
    const { describeEngines } = await import('./engine-selection');

    expect(describeEngines(machineWith([]), [])).toEqual([]);
  });
});
