import * as path from 'node:path';

/**
 * Names the `tar` to extract archives with.
 *
 * ⛔ On Windows, never a bare `tar`. Windows ships bsdtar as `System32\tar.exe`, which reads zips and
 * understands drive letters; but Git for Windows puts GNU tar on PATH too (its `usr\bin`, when the
 * user chose to have its Unix tools on PATH), and a bare `tar` can resolve to that one first. GNU tar
 * reads `C:\…` as `host:path`, a remote archive, and fails with "Cannot connect to C: resolve failed"
 * — which turned every plugin install on a GitHub Windows runner into "its download did not contain
 * what it should" (#1546's install gate found it). The system's own is asked for by its full path.
 *
 * Elsewhere `tar` on PATH is the system's.
 * @param platform The platform, for tests.
 * @param environment The environment, for tests.
 * @returns Returns the program to run.
 */
export function tarProgram(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== 'win32') {
    return 'tar';
  }
  const systemRoot: string =
    environment['SystemRoot'] ?? environment['SYSTEMROOT'] ?? 'C:\\Windows';
  return path.win32.join(systemRoot, 'System32', 'tar.exe');
}
