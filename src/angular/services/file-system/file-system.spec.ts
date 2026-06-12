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

  it('openDialog_whenOutsideElectron_returnsNull', async () => {
    expect(await fileSystem.openDialog()).toBeNull();
  });
});
