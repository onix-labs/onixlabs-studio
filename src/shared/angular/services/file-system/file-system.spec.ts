import { TestBed } from '@angular/core/testing';

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
