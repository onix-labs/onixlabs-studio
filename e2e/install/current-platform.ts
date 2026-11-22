import { LinuxPlatform } from './linux-platform';
import { MacosPlatform } from './macos-platform';
import type { StudioPlatform } from './studio-platform';
import { WindowsPlatform } from './windows-platform';

/**
 * Resolves the platform the gate is running on.
 * @returns Returns the platform.
 * @throws Error when the platform has no installer step.
 */
export function currentPlatform(): StudioPlatform {
  switch (process.platform) {
    case 'linux':
      return new LinuxPlatform();
    case 'darwin':
      return new MacosPlatform();
    case 'win32':
      return new WindowsPlatform();
    default:
      throw new Error(`The install gate has no installer step for ${process.platform}.`);
  }
}
