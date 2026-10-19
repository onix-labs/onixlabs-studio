import { randomUUID } from 'node:crypto';
import { promises as fs, Stats } from 'node:fs';
import * as nodePath from 'node:path';
import {
  DiskFileEdits,
  DiskTextEdit,
  ReplaceFailure,
  TextEditsRequest,
  TextEditsResponse,
  WrittenFile,
} from '@shared/api/search-channels';
import { logger } from './logger';
import { WorkspaceContext } from './workspace-context';

/**
 * Caps how many files one request may write, as a replace's are capped: a rename across more files
 * than this did not come from a rename.
 */
const MAX_EDIT_FILES: number = 5000;

/**
 * Caps how many edits one file may take.
 */
const MAX_EDITS_PER_FILE: number = 100_000;

/**
 * Caps the size of a file changed on disk, in bytes. A source file a rename touches is far smaller;
 * one this large is generated, or not text, and is refused rather than read whole into memory.
 */
export const MAX_EDIT_FILE_BYTES: number = 10 * 1024 * 1024;

/**
 * Holds the byte-order mark a UTF-8 file may start with. A language server counts positions in the
 * text after it, so it is set aside while the edits apply and put back on write.
 */
const BYTE_ORDER_MARK: string = '﻿';

/**
 * Determines whether an unknown value is a well-formed {@link TextEditsRequest}.
 * @param request The value to check.
 * @returns Returns true when the value has the expected shape.
 */
export function isTextEditsRequest(request: unknown): request is TextEditsRequest {
  if (typeof request !== 'object' || request === null) {
    return false;
  }
  const files: unknown = (request as { files?: unknown }).files;
  return (
    Array.isArray(files) &&
    files.every((file: unknown): boolean => {
      if (typeof file !== 'object' || file === null) {
        return false;
      }
      const candidate: { path?: unknown; edits?: unknown } = file;
      return (
        typeof candidate.path === 'string' &&
        candidate.path.length > 0 &&
        Array.isArray(candidate.edits) &&
        candidate.edits.every(isDiskTextEdit)
      );
    })
  );
}

/**
 * Determines whether an unknown value is a well-formed {@link DiskTextEdit}: a one-based span and its
 * replacement text.
 * @param edit The value to check.
 * @returns Returns true when the value has the expected shape.
 */
function isDiskTextEdit(edit: unknown): boolean {
  if (typeof edit !== 'object' || edit === null) {
    return false;
  }
  const candidate: Partial<Record<keyof DiskTextEdit, unknown>> = edit;
  return (
    isPositive(candidate.startLineNumber) &&
    isPositive(candidate.startColumn) &&
    isPositive(candidate.endLineNumber) &&
    isPositive(candidate.endColumn) &&
    typeof candidate.text === 'string'
  );
}

/**
 * Determines whether a value is a whole number of one or more.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isPositive(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1;
}

/**
 * Applies text edits to workspace files on disk (#1015): a rename's edits to the files no editor has
 * open, which an editor's undo cannot reach and so are written straight to the file.
 *
 * ⛔ Confinement is the whole of its trust, as {@link import('./search-replace-files').replaceInFiles}'s
 * is. The renderer names the files, so each must lie inside an OPEN workspace root both as named and
 * as resolved through any symlink; a file that fails either test is refused and named, never written.
 * Binary files (a NUL byte), files over {@link MAX_EDIT_FILE_BYTES}, and files whose edits overlap or
 * fall outside the text are refused too.
 *
 * Each file is written whole or not at all: the new text goes to a temporary file beside it, which
 * then replaces it in one rename, so a crash or a full disk mid-write never leaves half a file.
 * @param request The validated request.
 * @param workspace The workspace context deciding which roots are open.
 * @returns Returns the files written, and those that were not.
 */
export async function applyTextEdits(
  request: TextEditsRequest,
  workspace: WorkspaceContext,
): Promise<TextEditsResponse> {
  const written: WrittenFile[] = [];
  const failed: ReplaceFailure[] = [];
  if (request.files.length > MAX_EDIT_FILES) {
    logger.warn('ApplyTextEdits', `Refused text edits naming ${request.files.length} files`);
    return {
      written,
      failed: request.files.map((file: DiskFileEdits): ReplaceFailure => ({
        path: file.path,
        reason: 'Too many files were named at once.',
      })),
    };
  }
  const seen: Set<string> = new Set<string>();
  for (const file of request.files) {
    const resolved: string = nodePath.resolve(file.path);
    if (seen.has(resolved)) {
      failed.push({ path: file.path, reason: 'It was named twice.' });
      continue;
    }
    seen.add(resolved);
    const reason: string | null = await applyToFile(file, resolved, workspace);
    if (reason === null) {
      written.push({ path: file.path, edits: file.edits.length });
    } else {
      failed.push({ path: file.path, reason });
    }
  }
  logger.info(
    'ApplyTextEdits',
    `Wrote ${written.length} file(s) on disk${failed.length > 0 ? `; ${failed.length} refused` : ''}`,
  );
  return { written, failed };
}

/**
 * Applies one file's edits on disk, confined to the open workspace root it lies in.
 * @param file The file and its edits.
 * @param resolved The file's absolute path, resolved.
 * @param workspace The workspace context deciding which roots are open.
 * @returns Returns null when the file was written, or the reason it was not.
 */
async function applyToFile(
  file: DiskFileEdits,
  resolved: string,
  workspace: WorkspaceContext,
): Promise<string | null> {
  const root: string | undefined = workspace.rootContaining(resolved);
  if (root === undefined) {
    return 'It is outside the workspace.';
  }
  if (file.edits.length > MAX_EDITS_PER_FILE) {
    return 'It has too many edits.';
  }
  let real: string;
  let stats: Stats;
  try {
    const realRoot: string = await fs.realpath(root);
    real = await fs.realpath(resolved);
    if (!isInside(real, realRoot)) {
      return 'It links to somewhere outside the workspace.';
    }
    stats = await fs.stat(real);
  } catch (error: unknown) {
    logger.warn('ApplyTextEdits', `Could not resolve ${file.path}`, error);
    return 'It could not be found.';
  }
  if (!stats.isFile()) {
    return 'It is not a file.';
  }
  if (stats.size > MAX_EDIT_FILE_BYTES) {
    return 'It is too large to change on disk.';
  }
  let original: Buffer;
  try {
    original = await fs.readFile(real);
  } catch (error: unknown) {
    logger.warn('ApplyTextEdits', `Could not read ${file.path}`, error);
    return 'It could not be read.';
  }
  if (original.includes(0)) {
    return 'It looks like a binary file.';
  }
  const decoded: string = original.toString('utf8');
  const bom: string = decoded.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const edited: string | null = applyEditsToText(decoded.slice(bom.length), file.edits);
  if (edited === null) {
    return 'Its edits overlap.';
  }
  try {
    await writeAtomically(real, bom + edited, stats.mode);
  } catch (error: unknown) {
    logger.warn('ApplyTextEdits', `Could not write ${file.path}`, error);
    return 'It could not be written.';
  }
  return null;
}

/**
 * Applies edits to a text. Each span is clamped to the text — a column past a line's end is its end,
 * a line past the last is the end of the text, as a language server's positions are read — and the
 * edits are applied from the last to the first, so no edit moves another's span. Edits starting at
 * one place (two inserts) apply in the order given.
 * @param text The text.
 * @param edits The edits, in any order.
 * @returns Returns the edited text, or null when two edits overlap.
 */
export function applyEditsToText(text: string, edits: readonly DiskTextEdit[]): string | null {
  const lineStarts: number[] = [0];
  for (let index: number = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
  }
  const offsetOf: (line: number, column: number) => number = (
    line: number,
    column: number,
  ): number => {
    const start: number | undefined = lineStarts[line - 1];
    if (start === undefined) {
      return text.length;
    }
    const next: number | undefined = lineStarts[line];
    // A line's end is before its line break, `\r\n` or `\n`; the last line ends with the text.
    let end: number = next === undefined ? text.length : next - 1;
    if (next !== undefined && end > start && text[end - 1] === '\r') {
      end -= 1;
    }
    return Math.min(start + column - 1, end);
  };
  const spans: { start: number; end: number; text: string; order: number }[] = edits.map(
    (
      edit: DiskTextEdit,
      order: number,
    ): { start: number; end: number; text: string; order: number } => {
      const start: number = offsetOf(edit.startLineNumber, edit.startColumn);
      return {
        start,
        end: Math.max(start, offsetOf(edit.endLineNumber, edit.endColumn)),
        text: edit.text,
        order,
      };
    },
  );
  spans.sort(
    (
      a: { start: number; end: number; order: number },
      b: { start: number; end: number; order: number },
    ): number => a.start - b.start || a.end - b.end || a.order - b.order,
  );
  for (let index: number = 1; index < spans.length; index++) {
    if (spans[index].start < spans[index - 1].end) {
      return null;
    }
  }
  let result: string = text;
  for (let index: number = spans.length - 1; index >= 0; index--) {
    const span: { start: number; end: number; text: string } = spans[index];
    result = result.slice(0, span.start) + span.text + result.slice(span.end);
  }
  return result;
}

/**
 * Writes a file whole or not at all: to a temporary file beside it, with its permissions, which then
 * replaces it in one rename. The temporary file is removed when anything fails.
 * @param target The file's real path.
 * @param text The new text.
 * @param mode The file's permission bits, kept.
 * @returns Returns a promise that resolves once the file is replaced.
 */
async function writeAtomically(target: string, text: string, mode: number): Promise<void> {
  const temporary: string = nodePath.join(
    nodePath.dirname(target),
    `.${nodePath.basename(target)}.${randomUUID()}.studio-tmp`,
  );
  try {
    await fs.writeFile(temporary, text, { encoding: 'utf8', mode });
    await fs.rename(temporary, target);
  } catch (error: unknown) {
    await fs.rm(temporary, { force: true }).catch((): void => undefined);
    throw error;
  }
}

/**
 * Determines whether a resolved path lies strictly inside a directory.
 * @param target The resolved path.
 * @param directory The resolved directory.
 * @returns Returns true when the path is inside it.
 */
function isInside(target: string, directory: string): boolean {
  return target.startsWith(directory + nodePath.sep);
}
