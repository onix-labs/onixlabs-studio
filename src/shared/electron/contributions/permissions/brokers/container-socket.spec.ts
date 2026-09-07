import { afterEach, describe, expect, it } from 'vitest';
import { ContainerEngineDescriptor } from '../../containers/container-engine';
import { contributedEngines } from '../../containers/container-engine-registry';
import { DiscoveryEnvironment } from '../../containers/socket-discovery';
import {
  ContainerSocket,
  ContainerSocketFactory,
  resolveContainerSocketPath,
} from './container-socket';

/**
 * Builds the Podman engine as its plugin contributes it, so a test can have an engine installed
 * without depending on one being compiled in.
 * @returns Returns the descriptor.
 */
function podmanEngine(): ContainerEngineDescriptor {
  return {
    id: 'podman',
    displayName: 'Podman',
    priority: 50,
    cli: '/plugins/podman-engine/bin/podman',
    discovery: {
      hostVariable: 'CONTAINER_HOST',
      dockerContext: false,
      defaults: (): readonly string[] => ['/run/podman/podman.sock'],
    },
    startCommand: (): string | null => 'podman machine start',
  };
}

/**
 * A machine with no engine socket, no `docker` configuration and nothing in the environment — so
 * resolution falls all the way through to the platform default.
 *
 * Injected rather than read from the real machine on purpose: once the socket is *discovered* (#593)
 * rather than assumed, asserting against the developer's own machine means asserting against whichever
 * container engine they happen to have running.
 * @param platform The platform to present.
 * @returns Returns the environment.
 */
function bareMachine(platform: NodeJS.Platform): DiscoveryEnvironment {
  return {
    platform,
    env: {},
    home: '/home/tester',
    exists: (): boolean => false,
    read: (): string | null => null,
  };
}

describe('ContainerSocketFactory', () => {
  it('mintsAHandleBoundToTheInjectedPath', () => {
    const factory: ContainerSocketFactory = new ContainerSocketFactory(
      (): string => '/custom/docker.sock',
    );
    const socket: ContainerSocket = factory.create();
    expect(socket.path).toBe('/custom/docker.sock');
    expect(typeof socket.connect).toBe('function');
  });

  it('declaresTheContainerSocketPermissionId', () => {
    expect(new ContainerSocketFactory().id).toBe('container.socket');
  });

  it('defaultsToTheResolvedContainerSocketPath', () => {
    // Asserts the wiring rather than a value: the factory with no resolver injected uses the one the
    // rest of the application uses, whatever that machine's engine turns out to be.
    expect(new ContainerSocketFactory().create().path).toBe(resolveContainerSocketPath());
  });
});

describe('resolveContainerSocketPath', () => {
  afterEach(() => {
    contributedEngines.replaceAll([]);
  });

  it('withNoEngineInstalled_namesNoSocket', () => {
    // Studio ships no engine since #596 and #597, so a machine with no engine plugin has no socket to
    // name — and the caller that would open one never gets that far (#595).
    expect(resolveContainerSocketPath(bareMachine('darwin'))).toBe('');
  });

  it('fallsBackToTheDefaultSocketOfTheEngineInEffect', () => {
    contributedEngines.replaceAll([podmanEngine()]);

    expect(resolveContainerSocketPath(bareMachine('darwin'))).toBe('/run/podman/podman.sock');
  });

  it('opensTheEndpointTheEnvironmentNames', () => {
    // The point of the change: Studio talks to whatever endpoint the user's own tooling talks to,
    // which is not the default path. Each engine names its own variable, and the docker-context route
    // to the same outcome is covered in `socket-discovery.spec.ts`.
    contributedEngines.replaceAll([podmanEngine()]);
    const contextual: DiscoveryEnvironment = {
      ...bareMachine('darwin'),
      env: { CONTAINER_HOST: 'unix:///home/tester/.local/share/containers/podman.sock' },
    };

    expect(resolveContainerSocketPath(contextual)).toBe(
      '/home/tester/.local/share/containers/podman.sock',
    );
  });
});
