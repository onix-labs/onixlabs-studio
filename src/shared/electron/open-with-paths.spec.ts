import { isAbsolutePathArgument, openFilePathsFromArgv } from './open-with-paths';

describe('isAbsolutePathArgument', () => {
  it('acceptsPosixWindowsDriveAndUncPaths', () => {
    expect(isAbsolutePathArgument('/home/user/notes.md')).toBe(true);
    expect(isAbsolutePathArgument('C:\\Users\\user\\notes.md')).toBe(true);
    expect(isAbsolutePathArgument('c:/Users/user/notes.md')).toBe(true);
    expect(isAbsolutePathArgument('\\\\server\\share\\notes.md')).toBe(true);
  });

  it('rejectsFlagsRelativePathsAndBareNames', () => {
    expect(isAbsolutePathArgument('--inspect')).toBe(false);
    expect(isAbsolutePathArgument('.')).toBe(false);
    expect(isAbsolutePathArgument('notes.md')).toBe(false);
    expect(isAbsolutePathArgument('src/notes.md')).toBe(false);
  });
});

describe('openFilePathsFromArgv', () => {
  it('packagedLaunch_skipsTheExecutableAndKeepsFileArguments', () => {
    const argv: readonly string[] = [
      'C:\\Program Files\\Studio\\Studio.exe',
      'C:\\Users\\user\\notes.md',
    ];

    expect(openFilePathsFromArgv(argv, false)).toEqual(['C:\\Users\\user\\notes.md']);
  });

  it('sourceLaunch_alsoSkipsTheAppDirectoryArgument', () => {
    const argv: readonly string[] = ['/usr/bin/electron', '.', '/home/user/notes.md'];

    expect(openFilePathsFromArgv(argv, true)).toEqual(['/home/user/notes.md']);
  });

  it('flagsAndRelativeArguments_areFilteredOut', () => {
    const argv: readonly string[] = [
      '/opt/studio/studio',
      '--no-sandbox',
      '--enable-logging',
      'relative.md',
      '/absolute/kept.md',
    ];

    expect(openFilePathsFromArgv(argv, false)).toEqual(['/absolute/kept.md']);
  });

  it('launchWithoutFileArguments_returnsNothing', () => {
    expect(openFilePathsFromArgv(['/opt/studio/studio'], false)).toEqual([]);
    expect(openFilePathsFromArgv([], false)).toEqual([]);
  });

  it('multipleFiles_arePreservedInOrder', () => {
    const argv: readonly string[] = ['/opt/studio/studio', '/a/one.md', '/b/two.cs'];

    expect(openFilePathsFromArgv(argv, false)).toEqual(['/a/one.md', '/b/two.cs']);
  });
});
