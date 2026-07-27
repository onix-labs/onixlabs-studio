import { allowsInput, buildSpawnSpec } from './terminal-spawn';

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
