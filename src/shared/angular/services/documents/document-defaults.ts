import type { DefaultEndOfLine } from '@shared/angular/services/settings/settings-registry';

/**
 * Resolves Default End of Line to the line ending a new document starts with: System is CRLF on
 * Windows and LF everywhere else.
 * @param setting Default End of Line.
 * @param platform The platform Studio runs on (`process.platform`), or undefined outside Electron.
 * @returns Returns the line ending.
 */
export function resolveDefaultEol(
  setting: DefaultEndOfLine,
  platform: string | undefined,
): 'LF' | 'CRLF' {
  if (setting === 'system') {
    return platform === 'win32' ? 'CRLF' : 'LF';
  }
  return setting === 'crlf' ? 'CRLF' : 'LF';
}
