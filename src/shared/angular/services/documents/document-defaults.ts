import type { TextDecodeOptions, TextEncoding } from '@shared/api/text-encodings';
import type { Settings } from '@shared/angular/services/settings/settings';
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

/**
 * Builds the decode options a file is read with from Default Encoding and Auto-Detect Encoding.
 * @param settings The settings, read for the two.
 * @param encoding An encoding to read in whatever the bytes suggest (Reopen with Encoding), or
 * undefined to tell it from them.
 * @returns Returns the options.
 */
export function textDecodeOptionsFrom(
  settings: Pick<Settings, 'get'>,
  encoding?: TextEncoding,
): TextDecodeOptions {
  return {
    fallback: settings.get('textEditor.defaultEncoding'),
    autoDetect: settings.get('textEditor.autoDetectEncoding'),
    ...(encoding === undefined ? {} : { encoding }),
  };
}
