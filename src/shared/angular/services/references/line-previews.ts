import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type { FileInfo } from '@shared/api/file-channels';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import { CodeLocation, ReferenceItem } from './reference-list';

/**
 * Holds the most files not open in an editor that one list reads from disk for its previews. A symbol
 * used across a large solution can be referenced from hundreds of files; past this many, the rest are
 * listed without their line rather than read.
 */
export const MAX_PREVIEW_FILES: number = 50;

/**
 * Holds the most characters of a line kept as its preview. A minified file's one line can run to
 * megabytes; the list shows a row's worth of it at most.
 */
export const MAX_PREVIEW_LENGTH: number = 500;

/**
 * Reads the line each place in a references list sits on (#1014), so every row can show it.
 *
 * A file open in an editor is read from its model, unsaved edits and all — the line as the user sees
 * it. A file nobody has opened is read from disk through the file client, once however many places
 * fall in it, and only the first {@link MAX_PREVIEW_FILES} such files are read; a line is cut to
 * {@link MAX_PREVIEW_LENGTH} characters. A place whose line cannot be read is still listed, with an
 * empty preview.
 */
@Service()
export class LinePreviews {
  /**
   * Holds the editor registry, which knows the model each open file is shown through.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the file client that reads a file not open in any editor.
   */
  private readonly files: FileSystem = inject(FileSystem);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Reads the line of every place.
   * @param locations The places, in the order to list them.
   * @param monaco The Monaco instance whose models hold the open files, or undefined when none has
   * loaded (every file is then read from disk).
   * @returns Returns the places with their lines, in the same order.
   */
  public async fill(
    locations: readonly CodeLocation[],
    monaco: typeof MonacoApi | undefined,
  ): Promise<readonly ReferenceItem[]> {
    const models: ReadonlyMap<string, MonacoApi.editor.ITextModel> = modelsOf(monaco);
    const lines: Map<string, readonly string[] | null> = new Map<
      string,
      readonly string[] | null
    >();
    const unread: string[] = [];
    for (const { path } of locations) {
      if (lines.has(path) || unread.includes(path)) {
        continue;
      }
      const model: MonacoApi.editor.ITextModel | undefined = models.get(
        this.editors.modelUriForPath(path) ?? path,
      );
      if (model !== undefined) {
        lines.set(path, model.getLinesContent());
      } else {
        unread.push(path);
      }
    }
    const reading: readonly string[] = unread.slice(0, MAX_PREVIEW_FILES);
    if (unread.length > reading.length) {
      this.log.debug(
        'references',
        'Previews read for the first files only',
        reading.length,
        unread.length,
      );
    }
    const read: readonly (readonly string[] | null)[] = await Promise.all(
      reading.map((path: string): Promise<readonly string[] | null> => this.readLines(path)),
    );
    reading.forEach((path: string, index: number): void => void lines.set(path, read[index]));
    return locations.map((location: CodeLocation): ReferenceItem => ({
      path: location.path,
      range: location.range,
      preview: clip(lines.get(location.path)?.[location.range.startLineNumber - 1] ?? ''),
    }));
  }

  /**
   * Reads a file from disk as lines.
   * @param path The absolute path.
   * @returns Returns the lines, or null when the file could not be read.
   */
  private async readLines(path: string): Promise<readonly string[] | null> {
    try {
      const info: FileInfo | null = await this.files.read(path);
      return info === null ? null : info.content.split(/\r\n|\r|\n/);
    } catch {
      return null;
    }
  }
}

/**
 * Maps every model of a Monaco instance by its URI.
 * @param monaco The instance, or undefined when none has loaded.
 * @returns Returns the models by URI.
 */
function modelsOf(
  monaco: typeof MonacoApi | undefined,
): ReadonlyMap<string, MonacoApi.editor.ITextModel> {
  const models: Map<string, MonacoApi.editor.ITextModel> = new Map<
    string,
    MonacoApi.editor.ITextModel
  >();
  for (const model of monaco?.editor.getModels() ?? []) {
    if (!model.isDisposed()) {
      models.set(model.uri.toString(), model);
    }
  }
  return models;
}

/**
 * Cuts a line to the preview length.
 * @param line The line.
 * @returns Returns the line, cut when it was longer.
 */
function clip(line: string): string {
  return line.length > MAX_PREVIEW_LENGTH ? line.slice(0, MAX_PREVIEW_LENGTH) : line;
}
