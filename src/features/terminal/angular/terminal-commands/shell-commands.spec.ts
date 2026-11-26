import {
  listCommand,
  locationCommand,
  ShellFamily,
  shellFamilyOf,
  TerminalListing,
  TerminalLocation,
} from './shell-commands';

/**
 * Every listing the List button offers.
 */
const LISTINGS: readonly TerminalListing[] = ['names', 'all', 'byTime', 'bySize', 'folders'];

/**
 * Every location the Home button offers.
 */
const LOCATIONS: readonly TerminalLocation[] = [
  'home',
  'root',
  'up',
  'previous',
  'desktop',
  'documents',
  'downloads',
];

describe('shellFamilyOf', () => {
  it.each<[string, string, ShellFamily]>([
    ['/bin/zsh', 'darwin', 'posix'],
    ['/bin/bash', 'linux', 'posix'],
    ['/usr/bin/fish', 'linux', 'fish'],
    ['/opt/homebrew/bin/fish', 'darwin', 'fish'],
    ['/usr/local/bin/pwsh', 'darwin', 'pwsh'],
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32', 'pwsh'],
    [
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'win32',
      'windows-powershell',
    ],
    ['C:\\Windows\\System32\\cmd.exe', 'win32', 'cmd'],
    ['C:\\WINDOWS\\system32\\CMD.EXE', 'win32', 'cmd'],
    ['C:\\Program Files\\Git\\bin\\bash.exe', 'win32', 'posix'],
  ])('%s on %s is %s', (shellPath: string, platform: string, expected: ShellFamily) => {
    expect(shellFamilyOf(shellPath, platform)).toBe(expected);
  });

  it('unknownShell_fallsBackToThePlatformsUsualShell', () => {
    expect(shellFamilyOf(null, 'darwin')).toBe('posix');
    expect(shellFamilyOf(null, 'linux')).toBe('posix');
    expect(shellFamilyOf('', 'win32')).toBe('windows-powershell');
  });
});

describe('listCommand', () => {
  it('listAll_writesEachShellsOwnCommand', () => {
    expect(listCommand('posix', 'all')).toBe('ls -la');
    expect(listCommand('fish', 'all')).toBe('ls -la');
    expect(listCommand('pwsh', 'all')).toBe('Get-ChildItem -Force');
    expect(listCommand('windows-powershell', 'all')).toBe('Get-ChildItem -Force');
    expect(listCommand('cmd', 'all')).toBe('dir /a');
  });

  it('powerShell_neverReliesOnTheLsAlias', () => {
    // `ls` is Get-ChildItem only on Windows; PowerShell on macOS and Linux runs /bin/ls instead.
    for (const listing of LISTINGS) {
      expect(listCommand('pwsh', listing)).not.toMatch(/^ls\b/);
    }
  });

  it('everyListing_hasACommandInEveryShell', () => {
    const families: readonly ShellFamily[] = ['posix', 'fish', 'pwsh', 'windows-powershell', 'cmd'];
    for (const family of families) {
      for (const listing of LISTINGS) {
        expect(listCommand(family, listing).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('locationCommand', () => {
  it('home_writesEachShellsOwnCommand', () => {
    expect(locationCommand('posix', 'home')).toBe('cd ~');
    expect(locationCommand('pwsh', 'home')).toBe('Set-Location ~');
    expect(locationCommand('cmd', 'home')).toBe('cd /d "%USERPROFILE%"');
  });

  it('root_writesEachShellsOwnCommand', () => {
    expect(locationCommand('posix', 'root')).toBe('cd /');
    expect(locationCommand('windows-powershell', 'root')).toBe('Set-Location /');
    expect(locationCommand('cmd', 'root')).toBe('cd \\');
  });

  it('previous_isUnavailableWhereTheShellKeepsNoPreviousDirectory', () => {
    expect(locationCommand('posix', 'previous')).toBe('cd -');
    expect(locationCommand('fish', 'previous')).toBe('cd -');
    expect(locationCommand('pwsh', 'previous')).toBe('Set-Location -');
    expect(locationCommand('windows-powershell', 'previous')).toBeNull();
    expect(locationCommand('cmd', 'previous')).toBeNull();
  });

  it('userFolders_followTheShell', () => {
    expect(locationCommand('posix', 'downloads')).toBe('cd ~/Downloads');
    expect(locationCommand('cmd', 'documents')).toBe('cd /d "%USERPROFILE%\\Documents"');
    // .NET follows a Desktop redirected into OneDrive; Downloads has no special folder there.
    expect(locationCommand('pwsh', 'desktop')).toBe(
      "Set-Location ([Environment]::GetFolderPath('Desktop'))",
    );
    expect(locationCommand('pwsh', 'downloads')).toBe('Set-Location ~/Downloads');
  });

  it('everyLocationButPrevious_hasACommandInEveryShell', () => {
    const families: readonly ShellFamily[] = ['posix', 'fish', 'pwsh', 'windows-powershell', 'cmd'];
    for (const family of families) {
      for (const location of LOCATIONS.filter((l: TerminalLocation): boolean => l !== 'previous')) {
        expect(locationCommand(family, location)).toBeTruthy();
      }
    }
  });
});
