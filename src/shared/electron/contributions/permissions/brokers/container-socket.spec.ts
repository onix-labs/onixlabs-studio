import { describe, expect, it } from 'vitest';
import {
  ContainerSocket,
  ContainerSocketFactory,
  resolveContainerSocketPath,
} from './container-socket';

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

  it('defaultsToThePlatformSocketPath', () => {
    const expected: string =
      process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock';
    expect(new ContainerSocketFactory().create().path).toBe(expected);
  });
});

describe('resolveContainerSocketPath', () => {
  it('resolvesTheWindowsNamedPipeOrTheUnixSocket', () => {
    const expected: string =
      process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock';
    expect(resolveContainerSocketPath()).toBe(expected);
  });
});
