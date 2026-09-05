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
  it('fallsBackToTheUnixSocketOfTheEngineInEffect', () => {
    // Docker left core with #596, so the built-in engine a bare machine falls back to is Podman.
    // Which engine that is matters far less than that the fallback is the engine's own default.
    expect(resolveContainerSocketPath(bareMachine('darwin'))).toBe('/run/podman/podman.sock');
  });

  it('fallsBackToTheWindowsNamedPipeOfTheEngineInEffect', () => {
    expect(resolveContainerSocketPath(bareMachine('win32'))).toBe(
      '\\\\.\\pipe\\podman-machine-default',
    );
  });

  it('opensTheEndpointTheEnvironmentNames', () => {
    // The point of the change: Studio talks to whatever endpoint the user's own tooling talks to,
    // which is not the default path. Each engine names its own variable — Podman's is `CONTAINER_HOST`
    // — and the docker-context route to the same outcome is covered in `socket-discovery.spec.ts`.
    const contextual: DiscoveryEnvironment = {
      ...bareMachine('darwin'),
      env: { CONTAINER_HOST: 'unix:///home/tester/.local/share/containers/podman.sock' },
    };

    expect(resolveContainerSocketPath(contextual)).toBe(
      '/home/tester/.local/share/containers/podman.sock',
    );
  });
});
