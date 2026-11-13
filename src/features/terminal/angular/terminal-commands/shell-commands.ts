/**
 * Defines the command dialects the terminal ribbon writes in. The dialect follows the shell running
 * in the terminal rather than the operating system: zsh on Windows (through Git Bash or MSYS) takes
 * POSIX commands, and PowerShell 7 on macOS takes PowerShell ones.
 * - `posix`: sh, bash, zsh, dash, ksh and the like.
 * - `fish`: fish, which takes POSIX commands but not POSIX parameter expansion.
 * - `pwsh`: PowerShell 7 and later.
 * - `windows-powershell`: Windows PowerShell 5.1 (`powershell.exe`), which has no `Set-Location -`.
 * - `cmd`: the Windows Command Prompt.
 */
export type ShellFamily = 'posix' | 'fish' | 'pwsh' | 'windows-powershell' | 'cmd';

/**
 * Defines the directory listings the List button offers.
 * - `names`: the names in the directory (`ls`).
 * - `all`: everything, hidden entries included, in long form (`ls -la`).
 * - `byTime`: long form, oldest first, so the most recently changed entries end up by the prompt.
 * - `bySize`: long form, largest first.
 * - `folders`: the directory's folders only.
 */
export type TerminalListing = 'names' | 'all' | 'byTime' | 'bySize' | 'folders';

/**
 * Defines the directories the Home button can go to.
 * - `home`: the user's home directory.
 * - `root`: the root of the file system (or, on Windows, of the current drive).
 * - `up`: the parent of the current directory.
 * - `previous`: the directory the shell was in before its last change of directory.
 * - `desktop`, `documents`, `downloads`: the user's folders of those names.
 */
export type TerminalLocation =
  'home' | 'root' | 'up' | 'previous' | 'desktop' | 'documents' | 'downloads';

/**
 * Holds each listing's command, by dialect. The PowerShell dialects share theirs.
 */
const LISTINGS: Readonly<
  Record<TerminalListing, Readonly<Record<'posix' | 'powershell' | 'cmd', string>>>
> = {
  names: { posix: 'ls', powershell: 'Get-ChildItem', cmd: 'dir' },
  all: { posix: 'ls -la', powershell: 'Get-ChildItem -Force', cmd: 'dir /a' },
  byTime: {
    posix: 'ls -ltr',
    powershell: 'Get-ChildItem | Sort-Object LastWriteTime',
    cmd: 'dir /o:d',
  },
  bySize: {
    posix: 'ls -lS',
    powershell: 'Get-ChildItem -File | Sort-Object Length -Descending',
    cmd: 'dir /o:-s',
  },
  folders: { posix: 'ls -d */', powershell: 'Get-ChildItem -Directory', cmd: 'dir /a:d' },
};

/**
 * Holds the special folders PowerShell resolves through .NET, which follows a Desktop or Documents
 * redirected into OneDrive where a path under `~` would not. Downloads has no such folder in .NET.
 */
const DOTNET_FOLDERS: Readonly<Partial<Record<TerminalLocation, string>>> = {
  desktop: 'Desktop',
  documents: 'MyDocuments',
};

/**
 * Holds the name each user folder has under the home directory.
 */
const HOME_FOLDERS: Readonly<Partial<Record<TerminalLocation, string>>> = {
  desktop: 'Desktop',
  documents: 'Documents',
  downloads: 'Downloads',
};

/**
 * Works out the command dialect of a shell from its executable path, falling back to the platform's
 * usual shell when the terminal has not reported one yet.
 * @param shellPath The shell's executable path, or null when it is not yet known.
 * @param platform The operating system platform (`process.platform`'s values).
 * @returns Returns the shell's dialect.
 */
export function shellFamilyOf(shellPath: string | null, platform: string): ShellFamily {
  if (shellPath === null || shellPath.length === 0) {
    return platform === 'win32' ? 'windows-powershell' : 'posix';
  }
  const base: string = (shellPath.split(/[\\/]/).pop() ?? shellPath).toLowerCase();
  const name: string = base.replace(/\.exe$/, '');
  switch (name) {
    case 'pwsh':
    case 'pwsh-preview':
      return 'pwsh';
    case 'powershell':
      return 'windows-powershell';
    case 'cmd':
      return 'cmd';
    case 'fish':
      return 'fish';
    default:
      return 'posix';
  }
}

/**
 * Gets the command that lists the current directory the given way.
 * @param family The shell's dialect.
 * @param listing The listing wanted.
 * @returns Returns the command to run.
 */
export function listCommand(family: ShellFamily, listing: TerminalListing): string {
  const commands: Readonly<Record<'posix' | 'powershell' | 'cmd', string>> = LISTINGS[listing];
  switch (family) {
    case 'pwsh':
    case 'windows-powershell':
      return commands.powershell;
    case 'cmd':
      return commands.cmd;
    default:
      return commands.posix;
  }
}

/**
 * Gets the command that changes to the given location, or null when the shell has no way to.
 * @param family The shell's dialect.
 * @param location The location wanted.
 * @returns Returns the command to run, or null when the shell cannot go there (cmd and Windows
 * PowerShell keep no previous directory).
 */
export function locationCommand(family: ShellFamily, location: TerminalLocation): string | null {
  switch (family) {
    case 'pwsh':
    case 'windows-powershell':
      return powerShellLocation(family, location);
    case 'cmd':
      return cmdLocation(location);
    default:
      return posixLocation(location);
  }
}

/**
 * Gets the POSIX (and fish) command that changes to the given location.
 * @param location The location wanted.
 * @returns Returns the command to run.
 */
function posixLocation(location: TerminalLocation): string {
  switch (location) {
    case 'home':
      return 'cd ~';
    case 'root':
      return 'cd /';
    case 'up':
      return 'cd ..';
    case 'previous':
      return 'cd -';
    default:
      return `cd ~/${HOME_FOLDERS[location] ?? ''}`;
  }
}

/**
 * Gets the PowerShell command that changes to the given location.
 * @param family The PowerShell dialect, which decides whether a previous directory is kept.
 * @param location The location wanted.
 * @returns Returns the command to run, or null when the dialect cannot go there.
 */
function powerShellLocation(family: ShellFamily, location: TerminalLocation): string | null {
  switch (location) {
    case 'home':
      return 'Set-Location ~';
    case 'root':
      // `/` is the root on Unix and, on Windows, the root of the current drive.
      return 'Set-Location /';
    case 'up':
      return 'Set-Location ..';
    case 'previous':
      return family === 'pwsh' ? 'Set-Location -' : null;
    default: {
      const special: string | undefined = DOTNET_FOLDERS[location];
      return special === undefined
        ? `Set-Location ~/${HOME_FOLDERS[location] ?? ''}`
        : `Set-Location ([Environment]::GetFolderPath('${special}'))`;
    }
  }
}

/**
 * Gets the Command Prompt command that changes to the given location. `/d` lets `cd` change drive
 * too, so going home from another drive lands there rather than only changing that drive's directory.
 * @param location The location wanted.
 * @returns Returns the command to run, or null when the Command Prompt cannot go there.
 */
function cmdLocation(location: TerminalLocation): string | null {
  switch (location) {
    case 'home':
      return 'cd /d "%USERPROFILE%"';
    case 'root':
      return 'cd \\';
    case 'up':
      return 'cd ..';
    case 'previous':
      return null;
    default:
      return `cd /d "%USERPROFILE%\\${HOME_FOLDERS[location] ?? ''}"`;
  }
}
