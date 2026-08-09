import { describe, expect, it } from 'vitest';
import { DesktopLaunchCommand, dockerDesktopLaunchCommand } from './docker-desktop';

describe('dockerDesktopLaunchCommand', () => {
  it('launchesDockerViaOpenOnMacOs', () => {
    const command: DesktopLaunchCommand | null = dockerDesktopLaunchCommand('darwin', {});
    expect(command).toEqual({ file: 'open', args: ['-a', 'Docker'], waitForExit: true });
  });

  it('startsTheUserServiceOnLinux', () => {
    const command: DesktopLaunchCommand | null = dockerDesktopLaunchCommand('linux', {});
    expect(command).toEqual({
      file: 'systemctl',
      args: ['--user', 'start', 'docker-desktop'],
      waitForExit: true,
    });
  });

  it('launchesTheExecutableFromTheInstallDirectoryOnWindows', () => {
    const command: DesktopLaunchCommand | null = dockerDesktopLaunchCommand('win32', {
      ProgramFiles: 'D:\\Programs',
    });
    expect(command?.waitForExit).toBe(false);
    expect(command?.file).toContain('Docker Desktop.exe');
    expect(command?.file).toContain('D:\\Programs');
  });

  it('isUnsupportedOnOtherPlatforms', () => {
    expect(dockerDesktopLaunchCommand('freebsd', {})).toBeNull();
  });
});
