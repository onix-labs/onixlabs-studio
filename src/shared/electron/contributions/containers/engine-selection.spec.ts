import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ContainerEngineInfo } from '@shared/api/container-types';

/**
 * Holds the paths the stubbed file system reports as present. Sockets and the choice store are both
 * looked up through `existsSync`, so one set drives both.
 */
let present: Set<string>;

/**
 * Holds the engine choice the stubbed store reads back, or null when the user has never chosen.
 */
let storedChoice: string | null;

// The module resolves its store under the user-data directory and probes engine sockets on the real
// file system, neither of which a unit test can answer for. Both are stubbed so the selection rule
// under test — which engine is in effect, and what it is told to say when none is running — can be
// exercised on any machine, with or without a container engine installed.
vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }));
vi.mock('node:fs', () => ({
  existsSync: (file: string): boolean => present.has(file),
  readFileSync: (): string => JSON.stringify({ engine: storedChoice }),
  writeFileSync: (): void => undefined,
}));

const { describeEngines, selectedEngine } = await import('./engine-selection');

/**
 * The choice store's path, as the module resolves it.
 */
const STORE: string = path.join(tmpdir(), 'container-engine.json');

/**
 * The Docker socket on the platforms the suite runs on.
 */
const DOCKER_SOCKET: string = '/var/run/docker.sock';

/**
 * Prepares the stubbed environment.
 * @param options The sockets present on the machine and the engine the user has chosen.
 */
function given(options: { sockets?: readonly string[]; chosen?: string | null }): void {
  present = new Set<string>(options.sockets ?? []);
  storedChoice = options.chosen ?? null;
  if (storedChoice !== null) {
    present.add(STORE);
  }
  vi.resetModules();
}

/**
 * Gets the engine reported as in effect.
 * @returns Returns the engine description.
 */
function inEffect(): ContainerEngineInfo | undefined {
  return describeEngines().find((engine: ContainerEngineInfo): boolean => engine.inEffect);
}

describe('selectedEngine', () => {
  beforeEach(() => {
    given({});
  });

  it('withNothingInstalledAndNoChoice_fallsBackToTheDefaultEngine', async () => {
    given({});
    const { selectedEngine: resolve } = await import('./engine-selection');

    expect(resolve().id).toBe('docker');
  });

  it('withTheChosenEngineNotRunning_staysWithTheChoiceRatherThanTheDefault', async () => {
    // The bug this rule exists for: a Podman user whose machine is stopped has no socket at all, and
    // falling through to the catalogue default told them that *Docker* was not running.
    given({ chosen: 'podman' });
    const { selectedEngine: resolve } = await import('./engine-selection');

    expect(resolve().id).toBe('podman');
  });

  it('withAnEngineRunning_prefersTheRunningEngineOverTheStaleChoice', async () => {
    given({ sockets: [DOCKER_SOCKET], chosen: 'nonexistent' });
    const { selectedEngine: resolve } = await import('./engine-selection');

    expect(resolve().id).toBe('docker');
  });
});

describe('describeEngines', () => {
  beforeEach(() => {
    given({});
  });

  it('reportsTheEngineInEffectEvenWhenItsSocketIsAbsent', async () => {
    given({ chosen: 'podman' });
    const module: typeof import('./engine-selection') = await import('./engine-selection');
    const podman: ContainerEngineInfo | undefined = module
      .describeEngines()
      .find((engine: ContainerEngineInfo): boolean => engine.id === 'podman');

    expect(podman?.inEffect).toBe(true);
    expect(podman?.available).toBe(false);
  });

  it('offersAStartCommandForAnEngineTheApplicationCannotLaunch', async () => {
    given({ chosen: 'podman' });
    const module: typeof import('./engine-selection') = await import('./engine-selection');
    const podman: ContainerEngineInfo | undefined = module
      .describeEngines()
      .find((engine: ContainerEngineInfo): boolean => engine.id === 'podman');

    expect(podman?.canLaunch).toBe(false);
    expect(podman?.startCommand).not.toBeNull();
  });

  it('offersNoStartCommandForAnEngineTheApplicationLaunchesItself', async () => {
    const module: typeof import('./engine-selection') = await import('./engine-selection');
    const docker: ContainerEngineInfo | undefined = module
      .describeEngines()
      .find((engine: ContainerEngineInfo): boolean => engine.id === 'docker');

    expect(docker?.startCommand).toBeNull();
  });

  it('namesExactlyOneEngineAsInEffect', () => {
    expect(inEffect()).toBeDefined();
    expect(
      describeEngines().filter((engine: ContainerEngineInfo): boolean => engine.inEffect),
    ).toHaveLength(1);
  });

  it('keepsSelectedEngineAndDescribeEnginesAgreeing', () => {
    expect(inEffect()?.id).toBe(selectedEngine().id);
  });
});
