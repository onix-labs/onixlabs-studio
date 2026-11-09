import { textDecodeOptions, type TextDecodeOptions } from '@shared/api/text-encodings';

/**
 * The largest file opened as editable text when the renderer does not say (50 MB): Large File Size
 * Limit's default. Bigger files — huge logs, generated SQL, data dumps — open in the binary/hex
 * editor, which windows its reads, instead of being decoded whole into one IPC payload and a Monaco
 * model.
 */
const DEFAULT_TEXT_FILE_MB: number = 50;

/**
 * The most Large File Size Limit may raise the cap to (1 GB), whatever the renderer asks for.
 */
const MAX_TEXT_FILE_MB: number = 1024;

/**
 * Reads the text-file cap the renderer asked for (Large File Size Limit, in megabytes), which is
 * untrusted: a positive number, clamped to 1–1024 MB, or the default when absent or unusable.
 * @param value The cap asked for.
 * @returns Returns the cap in bytes.
 */
export function textFileLimitBytes(value: unknown): number {
  const megabytes: number =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.min(Math.max(value, 1), MAX_TEXT_FILE_MB)
      : DEFAULT_TEXT_FILE_MB;
  return Math.round(megabytes * 1024 * 1024);
}

/**
 * Describes how a file opened from the renderer is read: the largest that opens as text, and how its
 * bytes decode.
 */
export interface TextReadPolicy {
  /**
   * Gets the largest file, in bytes, opened as text.
   */
  readonly limit: number;

  /**
   * Gets how the file's bytes decode.
   */
  readonly decode: TextDecodeOptions;
}

/**
 * Reads the policy the renderer asked for, which is untrusted, through {@link textFileLimitBytes} and
 * {@link textDecodeOptions}.
 * @param limitMb The text-file cap asked for, in megabytes.
 * @param decode The decode options asked for.
 * @returns Returns the policy.
 */
export function textReadPolicy(limitMb: unknown, decode: unknown): TextReadPolicy {
  return { limit: textFileLimitBytes(limitMb), decode: textDecodeOptions(decode) };
}
