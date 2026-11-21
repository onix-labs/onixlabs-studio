import { LinuxPlatform } from './linux-platform';
import type { StudioPlatform } from './studio-platform';

/**
 * Resolves the platform the gate is running on.
 * @returns Returns the platform.
 * @throws Error when the platform has no implementation yet.
 */
export function currentPlatform(): StudioPlatform {
  if (process.platform === 'linux') {
    return new LinuxPlatform();
  }
  // macOS and Windows install from the DMG and the NSIS installer respectively; both arrive with the
  // release.yml job (#1546). Failing here says so, rather than launching something that is not the
  // installed app.
  throw new Error(`The install gate has no installer step for ${process.platform} yet (#1546).`);
}
