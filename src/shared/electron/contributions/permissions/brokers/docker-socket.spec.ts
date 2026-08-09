import { describe, expect, it } from 'vitest';
import { DockerSocket, DockerSocketFactory, resolveDockerSocketPath } from './docker-socket';

describe('DockerSocketFactory', () => {
  it('mintsAHandleBoundToTheInjectedPath', () => {
    const factory: DockerSocketFactory = new DockerSocketFactory((): string => '/custom/docker.sock');
    const socket: DockerSocket = factory.create();
    expect(socket.path).toBe('/custom/docker.sock');
    expect(typeof socket.connect).toBe('function');
  });

  it('declaresTheDockerSocketPermissionId', () => {
    expect(new DockerSocketFactory().id).toBe('docker.socket');
  });

  it('defaultsToThePlatformSocketPath', () => {
    const expected: string =
      process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock';
    expect(new DockerSocketFactory().create().path).toBe(expected);
  });
});

describe('resolveDockerSocketPath', () => {
  it('resolvesTheWindowsNamedPipeOrTheUnixSocket', () => {
    const expected: string =
      process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock';
    expect(resolveDockerSocketPath()).toBe(expected);
  });
});
