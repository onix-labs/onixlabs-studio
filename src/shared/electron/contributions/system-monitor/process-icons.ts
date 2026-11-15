import * as path from 'node:path';

/**
 * Works out the file whose icon stands for a process: on macOS the outermost app bundle its executable
 * is in, so every helper of an app wears the app's icon; on Windows the executable itself, whose icon
 * is embedded in it. Elsewhere (and for a process outside any app bundle on macOS) there is no icon of
 * its own to look up.
 * @param location The folder the process's executable is in.
 * @param name The process's name.
 * @param platform The platform (`process.platform`).
 * @returns Returns the file to take the icon from, or null when the process has none of its own.
 */
export function iconTarget(location: string, name: string, platform: string): string | null {
  if (location.length === 0) {
    return null;
  }
  if (platform === 'darwin') {
    const segments: readonly string[] = location.split('/');
    const bundle: number = segments.findIndex((segment: string): boolean =>
      segment.endsWith('.app'),
    );
    return bundle < 0 ? null : segments.slice(0, bundle + 1).join('/');
  }
  if (platform === 'win32') {
    if (location.toLowerCase().endsWith('.exe')) {
      return location;
    }
    return name.toLowerCase().endsWith('.exe') ? path.win32.join(location, name) : null;
  }
  return null;
}
