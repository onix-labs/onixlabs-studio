import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type {
  DiskFileEdits,
  ReplaceFailure,
  TextEditsResponse,
  WrittenFile,
} from '@shared/api/search-channels';
import { Editors } from '@shared/angular/services/editors/editors';
import { Log } from '@shared/angular/services/log/log';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Search } from '@shared/angular/services/search/search';
import {
  AppliedFile,
  FileTextEdits,
  SkippedEdit,
  TextEditEntry,
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from './workspace-edit';

/**
 * Applies edits across a workspace (#1015): a rename's answer, or a language server's own
 * `workspace/applyEdit`.
 *
 * A document open in an editor is changed there, as the user would change it: every edit to it in one
 * undo stop, so one undo takes the whole change back, and left unsaved for the user to keep or not.
 * The edits are applied from the last to the first, so none moves another's span. A document no editor
 * has open is changed on disk through the main process, which confines it to the workspace and writes
 * it whole or not at all. Whatever is not applied — its edits overlap, it lies outside the workspace,
 * it is binary — is named with its reason, never dropped silently.
 */
@Service()
export class WorkspaceEditApplier {
  /**
   * Holds the editor registry, which knows the model each open file is shown through.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the Monaco service, whose main-window instance holds the open models.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the search client, whose main-process side writes the files no editor has open.
   */
  private readonly search: Search = inject(Search);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Applies edits across the workspace.
   * @param edit The edits, by document, and the parts already refused.
   * @param monaco The Monaco instance of the editor the change came from, whose models are looked in
   * first, or undefined for the main window's alone.
   * @returns Returns the documents changed, and the parts not applied with their reasons.
   */
  public async apply(
    edit: WorkspaceTextEdits,
    monaco?: typeof MonacoApi,
  ): Promise<WorkspaceEditOutcome> {
    const models: ReadonlyMap<string, MonacoApi.editor.ITextModel> = this.modelsOf(monaco);
    const applied: AppliedFile[] = [];
    const skipped: SkippedEdit[] = [...edit.refused];
    const disk: DiskFileEdits[] = [];
    for (const file of edit.files) {
      if (file.edits.length === 0) {
        continue;
      }
      const model: MonacoApi.editor.ITextModel | undefined = models.get(
        this.editors.modelUriForPath(file.path) ?? file.path,
      );
      if (model !== undefined) {
        const reason: string | null = applyToModel(model, file.edits);
        if (reason === null) {
          applied.push({ path: file.path, edits: file.edits.length, where: 'editor' });
        } else {
          skipped.push({ path: file.path, reason });
        }
      } else if (isAbsolutePath(file.path)) {
        disk.push({ path: file.path, edits: toDiskEdits(file) });
      } else {
        skipped.push({ path: file.path, reason: "It isn't open, and has no file on disk." });
      }
    }
    if (disk.length > 0) {
      const response: TextEditsResponse = await this.writeToDisk(disk);
      for (const written of response.written) {
        applied.push({ path: written.path, edits: written.edits, where: 'disk' });
      }
      skipped.push(
        ...response.failed.map((failure: ReplaceFailure): SkippedEdit => ({
          path: failure.path,
          reason: failure.reason,
        })),
      );
    }
    this.log.info(
      'workspaceEdit',
      `Applied edits to ${applied.length} document(s)`,
      skipped.length > 0 ? `${skipped.length} skipped` : '',
    );
    return { applied, skipped };
  }

  /**
   * Writes edits to files on disk, every file failed when the write itself could not be asked for.
   * @param disk The files and their edits.
   * @returns Returns what was written, and what was not.
   */
  private async writeToDisk(disk: readonly DiskFileEdits[]): Promise<TextEditsResponse> {
    try {
      return await this.search.applyTextEdits({ files: disk });
    } catch (error: unknown) {
      this.log.error('workspaceEdit', 'Could not write edits to disk', error);
      return {
        written: [] as readonly WrittenFile[],
        failed: disk.map((file: DiskFileEdits): ReplaceFailure => ({
          path: file.path,
          reason: 'It could not be written.',
        })),
      };
    }
  }

  /**
   * Maps the open models by URI: the given instance's first, then the main window's.
   * @param monaco The instance of the editor the change came from, or undefined.
   * @returns Returns the models by URI.
   */
  private modelsOf(
    monaco: typeof MonacoApi | undefined,
  ): ReadonlyMap<string, MonacoApi.editor.ITextModel> {
    const models: Map<string, MonacoApi.editor.ITextModel> = new Map<
      string,
      MonacoApi.editor.ITextModel
    >();
    for (const instance of [monaco, this.monaco.getMonaco()]) {
      for (const model of instance?.editor.getModels() ?? []) {
        const uri: string = model.uri.toString();
        if (!model.isDisposed() && !models.has(uri)) {
          models.set(uri, model);
        }
      }
    }
    return models;
  }
}

/**
 * Applies edits to an open model in one undo stop: closed off from the typing before it and after
 * it, so one undo takes back exactly this change. The edits are pushed from the last to the first.
 * @param model The model.
 * @param edits The edits, in any order.
 * @returns Returns null when they were applied, or the reason they were not.
 */
function applyToModel(
  model: MonacoApi.editor.ITextModel,
  edits: readonly TextEditEntry[],
): string | null {
  const ordered: readonly TextEditEntry[] = [...edits].sort(
    (a: TextEditEntry, b: TextEditEntry): number => compareStart(b, a),
  );
  for (let index: number = 1; index < ordered.length; index++) {
    // Descending: each edit must end at or before the one after it in the list begins.
    if (endsAfterStartOf(ordered[index], ordered[index - 1])) {
      return 'Its edits overlap.';
    }
  }
  model.pushStackElement();
  model.pushEditOperations(
    [],
    ordered.map((edit: TextEditEntry): MonacoApi.editor.IIdentifiedSingleEditOperation => ({
      range: edit.range,
      text: edit.text,
      forceMoveMarkers: true,
    })),
    (): null => null,
  );
  model.pushStackElement();
  return null;
}

/**
 * Compares two edits by where they start.
 * @param a The first edit.
 * @param b The second edit.
 * @returns Returns a negative number when the first starts earlier, positive when later, else zero.
 */
function compareStart(a: TextEditEntry, b: TextEditEntry): number {
  return (
    a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn
  );
}

/**
 * Determines whether one edit ends after another begins — so the two overlap, the first starting no
 * later than the second.
 * @param first The edit starting earlier.
 * @param second The edit starting later.
 * @returns Returns true when they overlap.
 */
function endsAfterStartOf(first: TextEditEntry, second: TextEditEntry): boolean {
  return (
    first.range.endLineNumber > second.range.startLineNumber ||
    (first.range.endLineNumber === second.range.startLineNumber &&
      first.range.endColumn > second.range.startColumn)
  );
}

/**
 * Maps a document's edits to the shape the main process writes.
 * @param file The document and its edits.
 * @returns Returns the edits.
 */
function toDiskEdits(file: FileTextEdits): DiskFileEdits['edits'] {
  return file.edits.map((edit: TextEditEntry): DiskFileEdits['edits'][number] => ({
    startLineNumber: edit.range.startLineNumber,
    startColumn: edit.range.startColumn,
    endLineNumber: edit.range.endLineNumber,
    endColumn: edit.range.endColumn,
    text: edit.text,
  }));
}

/**
 * Determines whether a document's key is an absolute file path (POSIX, or a Windows drive path)
 * rather than a model URI.
 * @param path The key.
 * @returns Returns true when it is a file path.
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path);
}
