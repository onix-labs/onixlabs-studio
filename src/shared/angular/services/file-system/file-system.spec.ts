import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { FileChannel, FileWriteResult } from '@shared/api/file-channels';
import { FileSystem } from './file-system';

describe('FileSystem', () => {
  let fileSystem: FileSystem;

  beforeEach(() => {
    fileSystem = TestBed.inject(FileSystem);
  });

  it('isElectron_whenBridgeAbsent_returnsFalse', () => {
    expect(fileSystem.isElectron).toBe(false);
  });

  it('read_whenOutsideElectron_returnsNull', async () => {
    expect(await fileSystem.read('/tmp/file.txt')).toBeNull();
  });

  it('write_whenOutsideElectron_returnsUnavailableResult', async () => {
    expect((await fileSystem.write('/tmp/file.txt', 'data')).success).toBe(false);
  });

  it('writeBytes_whenOutsideElectron_returnsUnavailableResult', async () => {
    expect((await fileSystem.writeBytes('/tmp/out.xlsx', new Uint8Array([1, 2]))).success).toBe(
      false,
    );
  });

  it('openDialog_whenOutsideElectron_returnsNoFiles', async () => {
    expect(await fileSystem.openDialog()).toEqual([]);
  });

  it('pickPaths_whenOutsideElectron_returnsNoPaths', async () => {
    expect(await fileSystem.pickPaths()).toEqual([]);
  });

  it('pickPath_whenOutsideElectron_returnsNull', async () => {
    // The single-result convenience still answers null rather than an empty array, so its callers —
    // locating a workspace, choosing a write-path root — read unchanged.
    expect(await fileSystem.pickPath('folder')).toBeNull();
  });
});

describe('FileSystem over the bridge', () => {
  let calls: { channel: string; args: unknown[] }[];

  beforeEach(() => {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        return Promise.resolve({ success: true, path: args[0] } as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
  });

  it('writeBytes_invokesTheWriteBytesChannelWithThePathAndBytes', async () => {
    const bytes: Uint8Array = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

    const result: FileWriteResult = await TestBed.inject(FileSystem).writeBytes(
      '/tmp/out.xlsx',
      bytes,
    );

    expect(calls).toEqual([{ channel: FileChannel.WriteBytes, args: ['/tmp/out.xlsx', bytes] }]);
    expect(result).toEqual({ success: true, path: '/tmp/out.xlsx' });
  });

  it('write_invokesTheTextWriteChannel_notTheBytesOne', async () => {
    await TestBed.inject(FileSystem).write('/tmp/out.csv', 'a,b', true);

    expect(calls).toEqual([{ channel: FileChannel.Write, args: ['/tmp/out.csv', 'a,b', true] }]);
  });
});
