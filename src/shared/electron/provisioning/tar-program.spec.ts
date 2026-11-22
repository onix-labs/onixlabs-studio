import { describe, expect, it } from 'vitest';

import { tarProgram } from './tar-program';

describe('tarProgram', () => {
  it('tarProgram_onWindows_namesTheSystemTarByItsFullPath', () => {
    // A bare `tar` can resolve to Git for Windows' GNU tar, which reads `C:\…` as a remote host.
    expect(tarProgram('win32', { SystemRoot: 'C:\\Windows' })).toBe(
      'C:\\Windows\\System32\\tar.exe',
    );
  });

  it('tarProgram_onWindowsWithAnotherSystemRoot_followsIt', () => {
    expect(tarProgram('win32', { SystemRoot: 'D:\\WINNT' })).toBe('D:\\WINNT\\System32\\tar.exe');
  });

  it('tarProgram_onWindowsWithNoSystemRoot_assumesTheDefault', () => {
    expect(tarProgram('win32', {})).toBe('C:\\Windows\\System32\\tar.exe');
  });

  it('tarProgram_elsewhere_isTheTarOnPath', () => {
    expect(tarProgram('darwin', {})).toBe('tar');
    expect(tarProgram('linux', {})).toBe('tar');
  });
});
