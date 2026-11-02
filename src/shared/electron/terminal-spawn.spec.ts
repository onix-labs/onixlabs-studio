import {
  allowsInput,
  buildSpawnSpec,
  interactiveShellArgs,
  splitShellArguments,
} from './terminal-spawn';

describe('buildSpawnSpec', () => {
  it('withoutACommand_spawnsTheInteractiveShell', () => {
    expect(buildSpawnSpec('darwin', '/bin/zsh')).toEqual({ file: '/bin/zsh', args: [] });
  });

  it('withABareCommand_runsItThroughThePosixShellNonInteractively', () => {
    expect(buildSpawnSpec('darwin', '/bin/zsh', 'dotnet build && ./run.sh')).toEqual({
      file: '/bin/zsh',
      args: ['-c', 'dotnet build && ./run.sh'],
    });
  });

  it('withABareCommand_onWindows_runsItThroughCmd', () => {
    expect(buildSpawnSpec('win32', 'C:\\Windows\\System32\\cmd.exe', 'dotnet build')).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'dotnet build'],
    });
  });

  it('withAnArgumentVector_spawnsTheCommandDirectly', () => {
    expect(buildSpawnSpec('darwin', '/bin/zsh', 'dotnet', ['run', '--project', 'src/Api'])).toEqual(
      {
        file: 'dotnet',
        args: ['run', '--project', 'src/Api'],
      },
    );
  });
});

describe('allowsInput', () => {
  it('shellAndRunSessions_acceptEverything', () => {
    expect(allowsInput('shell', 'ls -la\r')).toBe(true);
    expect(allowsInput('run', 'my input\r')).toBe(true);
    expect(allowsInput('run', '\x03')).toBe(true);
  });

  it('taskSessions_acceptOnlyTheBareInterrupt', () => {
    expect(allowsInput('task', '\x03')).toBe(true);
    expect(allowsInput('task', 'x')).toBe(false);
    expect(allowsInput('task', 'rm -rf /\r')).toBe(false);
    // An interrupt embedded in a paste is not a bare Ctrl+C.
    expect(allowsInput('task', 'abc\x03')).toBe(false);
  });
});

describe('interactiveShellArgs', () => {
  it('putsTheLoginFlagFirst_thenShellArguments', () => {
    expect(interactiveShellArgs('darwin', '--norc -i', true)).toEqual(['-l', '--norc', '-i']);
    expect(interactiveShellArgs('linux', undefined, false)).toEqual([]);
  });

  it('windowsHasNoLoginShell', () => {
    expect(interactiveShellArgs('win32', '-NoLogo', true)).toEqual(['-NoLogo']);
  });

  it('anInteractiveShell_startsWithThem', () => {
    expect(buildSpawnSpec('darwin', '/bin/zsh', undefined, undefined, ['-l'])).toEqual({
      file: '/bin/zsh',
      args: ['-l'],
    });
    // A command's own vector is untouched by them.
    expect(buildSpawnSpec('darwin', '/bin/zsh', 'make', undefined, ['-l'])).toEqual({
      file: '/bin/zsh',
      args: ['-c', 'make'],
    });
  });
});

describe('splitShellArguments', () => {
  it('splitsOnSpaces_andGroupsQuotes', () => {
    expect(splitShellArguments('  --rcfile "/my path/rc"  -i ')).toEqual([
      '--rcfile',
      '/my path/rc',
      '-i',
    ]);
    expect(splitShellArguments("-c 'echo $HOME'")).toEqual(['-c', 'echo $HOME']);
    expect(splitShellArguments('a\\ b ""')).toEqual(['a b', '']);
  });

  it('refusesAnOpenQuote_aNul_andTooManyArguments', () => {
    expect(splitShellArguments('"unclosed')).toBeNull();
    expect(splitShellArguments('a\0b')).toBeNull();
    expect(splitShellArguments(Array.from({ length: 65 }, () => 'x').join(' '))).toBeNull();
    expect(splitShellArguments('')).toEqual([]);
  });
});
