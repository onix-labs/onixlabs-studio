import * as path from 'node:path';
import type {
  EditorConfigCharset,
  EditorConfigEndOfLine,
  EditorConfigProperties,
  EditorConfigResolution,
} from '@shared/api/editor-config-channels';
import { NO_EDITOR_CONFIG } from '@shared/api/editor-config-channels';
import { matchesEditorConfigGlob } from './editor-config-glob';
import { EditorConfigFile, parseEditorConfig } from './editor-config-parser';

/**
 * Names the file holding a folder's EditorConfig.
 */
const FILE_NAME: string = '.editorconfig';

/**
 * Reads a text file, resolving to null when there is nothing to read.
 */
export type EditorConfigReader = (filePath: string) => Promise<string | null>;

/**
 * Reads a positive whole number.
 * @param value The property's value.
 * @returns Returns the number, or undefined when it is not one.
 */
function positive(value: string): number | undefined {
  return /^[1-9]\d{0,5}$/.test(value) ? Number(value) : undefined;
}

/**
 * Reads a true or false.
 * @param value The property's value.
 * @returns Returns the boolean, or undefined when it is neither.
 */
function bool(value: string): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

/**
 * Types the raw values in force. A value not understood is dropped, as if it were unset.
 * @param raw The merged values, with lower-case names.
 * @returns Returns the properties.
 */
function toProperties(raw: ReadonlyMap<string, string>): EditorConfigProperties {
  const read: (name: string) => string = (name: string): string =>
    (raw.get(name) ?? '').toLowerCase();
  const style: string = read('indent_style');
  const size: string = read('indent_size');
  const endOfLine: string = read('end_of_line');
  const charset: string = read('charset');
  const length: string = read('max_line_length');
  const indentSize: number | 'tab' | undefined = size === 'tab' ? 'tab' : positive(size);
  const tabWidth: number | undefined = positive(read('tab_width'));
  const trim: boolean | undefined = bool(read('trim_trailing_whitespace'));
  const finalNewline: boolean | undefined = bool(read('insert_final_newline'));
  const maxLineLength: number | 'off' | undefined = length === 'off' ? 'off' : positive(length);
  return {
    ...(style === 'tab' || style === 'space' ? { indentStyle: style } : {}),
    ...(indentSize === undefined ? {} : { indentSize }),
    ...(tabWidth === undefined ? {} : { tabWidth }),
    ...(endOfLine === 'lf' || endOfLine === 'crlf' || endOfLine === 'cr'
      ? { endOfLine: endOfLine satisfies EditorConfigEndOfLine }
      : {}),
    ...(charset === 'latin1' ||
    charset === 'utf-8' ||
    charset === 'utf-8-bom' ||
    charset === 'utf-16be' ||
    charset === 'utf-16le'
      ? { charset: charset satisfies EditorConfigCharset }
      : {}),
    ...(trim === undefined ? {} : { trimTrailingWhitespace: trim }),
    ...(finalNewline === undefined ? {} : { insertFinalNewline: finalNewline }),
    ...(maxLineLength === undefined ? {} : { maxLineLength }),
  };
}

/**
 * Resolves what the `.editorconfig` files above a file say about it. Reads from the file's folder
 * upwards, stopping at a `root = true`, then applies them top-down so nearer files win; within a file a
 * later matching section wins, and `unset` clears what came before it.
 * @param filePath The file's absolute path.
 * @param read Reads an `.editorconfig`.
 * @param paths The path module, so each platform's rules can be tested from any other.
 * @returns Returns the resolution.
 */
export async function resolveEditorConfig(
  filePath: string,
  read: EditorConfigReader,
  paths: typeof path = path,
): Promise<EditorConfigResolution> {
  if (!paths.isAbsolute(filePath)) {
    return NO_EDITOR_CONFIG;
  }
  const candidates: string[] = [];
  const files: { readonly folder: string; readonly file: EditorConfigFile }[] = [];
  let folder: string = paths.dirname(filePath);
  for (;;) {
    const candidate: string = paths.join(folder, FILE_NAME);
    candidates.push(candidate);
    const text: string | null = await read(candidate);
    const file: EditorConfigFile | null = text === null ? null : parseEditorConfig(text);
    if (file !== null) {
      files.unshift({ folder, file });
      if (file.root) {
        break;
      }
    }
    const parent: string = paths.dirname(folder);
    if (parent === folder) {
      break;
    }
    folder = parent;
  }
  const raw: Map<string, string> = new Map<string, string>();
  for (const { folder: base, file } of files) {
    const relative: string = paths.relative(base, filePath).split(paths.sep).join('/');
    for (const section of file.sections) {
      if (matchesEditorConfigGlob(section.glob, relative)) {
        for (const [name, value] of section.properties) {
          if (value.toLowerCase() === 'unset') {
            raw.delete(name);
          } else {
            raw.set(name, value);
          }
        }
      }
    }
  }
  return { properties: toProperties(raw), candidates };
}
