import { describe, expect, it } from 'vitest';
import { DiscoveryEnvironment } from '../../containers/socket-discovery';
import {
  ContainerSocket,
  ContainerSocketFactory,
  resolveContainerSocketPath,
} from './container-socket';

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
  it('fallsBackToTheUnixSocketWhenNothingNamesAnEndpoint', () => {
    expect(resolveContainerSocketPath(bareMachine('darwin'))).toBe('/var/run/docker.sock');
  });

  it('fallsBackToTheWindowsNamedPipeWhenNothingNamesAnEndpoint', () => {
    expect(resolveContainerSocketPath(bareMachine('win32'))).toBe('\\\\.\\pipe\\docker_engine');
  });

  it('opensTheEndpointTheEnvironmentNames', () => {
    // The point of the change: Studio talks to whatever the user's own `docker` command talks to,
    // which on a machine running Colima or OrbStack is not the default path. The context-store route
    // to the same outcome is covered in `socket-discovery.spec.ts`.
    const contextual: DiscoveryEnvironment = {
      ...bareMachine('darwin'),
      env: { DOCKER_HOST: 'unix:///home/tester/.colima/default/docker.sock' },
    };

    expect(resolveContainerSocketPath(contextual)).toBe('/home/tester/.colima/default/docker.sock');
  });
});
