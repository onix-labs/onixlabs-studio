import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { FileOperationResult } from '@shared/api/workspace-channels';
import { Documents } from '@shared/angular/services/documents/documents';
import { Editors } from '@shared/angular/services/editors/editors';
import { Log } from '@shared/angular/services/log/log';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { basename } from '@shared/angular/services/lsp/lsp-paths';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  FileTextEdits,
  movedEdits,
  TextEditEntry,
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { nestedRename } from '@shared/angular/services/workspace/file-nesting';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { confirmationFiles, RenameConfirmation } from './rename-confirmation';
import { TypeRename } from './type-rename';

/**
 * One file a group rename moves: where it is, and the name it is given.
 */
interface GroupMove {
  /**
   * Gets the file's absolute path.
   */
  readonly from: string;

  /**
   * Gets its new name.
   */
  readonly name: string;
}

/**
 * Renames a file or folder as an explorer does, with what refers to it following (#1207). Scoped
 * beside the workspace it renames in. An agent's rename goes through {@link Workspace} directly: it
 * must not raise a confirmation, and the agent can update the references itself.
 */
@Service()
export class EntryRename {
  /**
   * Holds the workspace the entry is renamed in.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the language client, which asks the servers what else a rename changes.
   */
  private readonly client: LspClient = inject(LspClient);

  /**
   * Holds the confirmation shown before several files are changed.
   */
  private readonly confirmation: RenameConfirmation = inject(RenameConfirmation);

  /**
   * Holds the applier the edits go through.
   */
  private readonly applier: WorkspaceEditApplier = inject(WorkspaceEditApplier);

  /**
   * Holds the editor registry, which knows the model each open file is shown through.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the workspace's documents, saved after a rename when the user asks for that.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the settings, which say whether to confirm and whether to save.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the injector the type rename and the notifications are resolved from when a group is
   * renamed: neither is needed by a rename of one entry.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Renames an entry. The language servers are asked first what else has to change — the imports of
   * it, for TypeScript — and that is applied once the rename has worked, so a refused rename changes
   * nothing. Changing several files is confirmed as the rename of a symbol is; declined, the rename
   * still happens, alone.
   * @param path The absolute path of the entry to rename.
   * @param name The new name (a single path segment).
   * @returns Returns the result describing success and the new path, or the failure's message.
   */
  public async rename(path: string, name: string): Promise<FileOperationResult> {
    const separator: number = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const planned: string = `${path.slice(0, separator + 1)}${name}`;
    const edits: WorkspaceTextEdits = await this.client.fileRenameEdits(path, planned);
    const monaco: typeof MonacoApi | undefined = window.monaco;
    const follows: boolean = await this.shouldFollow(edits, path, name, monaco);
    const result: FileOperationResult = await this.workspace.rename(path, name);
    if (follows && result.success && result.path !== undefined) {
      await this.apply(movedEdits(edits, path, result.path), monaco);
    }
    return result;
  }

  /**
   * Renames a file with others nested beneath it, and them with it (File Nesting): each nested file
   * keeps its own part of the name, so `Enumeration.Comparable.cs` under `Enumeration.cs` renamed
   * `Ordinal.cs` becomes `Ordinal.Comparable.cs`. When the file declares a type named after it — the
   * parts of a partial class — the language server renames the type too, in every file that declares
   * or uses it. What changes in the code is confirmed as one rename across files is; declined, the
   * files are still renamed, alone.
   * @param path The absolute path of the file to rename.
   * @param name Its new name (a single path segment).
   * @param nested The absolute paths of the files nested beneath it.
   * @returns Returns the result of renaming the file itself; a nested file that could not follow is
   * reported on its own.
   */
  public async renameGroup(
    path: string,
    name: string,
    nested: readonly string[],
  ): Promise<FileOperationResult> {
    const parentName: string = basename(path);
    const moves: readonly GroupMove[] = nested
      .map((child: string): GroupMove => ({
        from: child,
        name: nestedRename(basename(child), parentName, name),
      }))
      .filter((move: GroupMove): boolean => move.name !== basename(move.from));
    const oldType: string = stem(parentName);
    const newType: string = stem(name);
    const typeEdits: WorkspaceTextEdits | null =
      oldType === newType
        ? null
        : await this.injector.get(TypeRename).editsFor(path, oldType, newType);
    const fileEdits: readonly WorkspaceTextEdits[] = await Promise.all(
      [{ from: path, name }, ...moves].map((move: GroupMove): Promise<WorkspaceTextEdits> =>
        this.client.fileRenameEdits(move.from, sibling(move.from, move.name)),
      ),
    );
    const edits: WorkspaceTextEdits = mergeEdits([
      ...(typeEdits === null ? [] : [typeEdits]),
      ...fileEdits,
    ]);
    const monaco: typeof MonacoApi | undefined = window.monaco;
    const follows: boolean = await this.shouldFollow(
      edits,
      path,
      name,
      monaco,
      typeEdits === null ? undefined : `Rename ${oldType} to ${newType}?`,
    );
    const result: FileOperationResult = await this.workspace.rename(path, name);
    if (!result.success || result.path === undefined) {
      return result;
    }
    let moved: WorkspaceTextEdits = movedEdits(edits, path, result.path);
    const failed: string[] = [];
    for (const move of moves) {
      const renamed: FileOperationResult = await this.workspace.rename(move.from, move.name);
      if (renamed.success && renamed.path !== undefined) {
        moved = movedEdits(moved, move.from, renamed.path);
      } else {
        failed.push(basename(move.from));
      }
    }
    if (failed.length > 0) {
      this.log.warn('rename', 'Nested files could not follow their parent', failed);
      this.injector.get(Notifications).notify({
        severity: 'warning',
        title:
          failed.length === 1
            ? `Couldn't rename ${failed[0]}`
            : `Couldn't rename ${failed.length} nested files`,
        detail: `${parentName} was renamed ${name}, but ${failed.join(', ')} kept ${failed.length === 1 ? 'its name' : 'their names'}.`,
      });
    }
    if (follows) {
      await this.apply(moved, monaco);
    }
    return result;
  }

  /**
   * Determines whether the edits are to be applied: there are some, and they change one file, or the
   * user is not asked, or says so.
   * @param edits The edits.
   * @param path The entry's path.
   * @param name Its new name.
   * @param monaco The Monaco instance, or undefined outside Electron.
   * @param title The question to ask, or undefined for the references question.
   * @returns Returns a promise resolving to true when they are.
   */
  private async shouldFollow(
    edits: WorkspaceTextEdits,
    path: string,
    name: string,
    monaco: typeof MonacoApi | undefined,
    title?: string,
  ): Promise<boolean> {
    if (edits.files.length === 0) {
      return false;
    }
    if (edits.files.length === 1 || !this.settings.get('textEditor.confirmMultiFileRename')) {
      return true;
    }
    const oldName: string = basename(path);
    return this.confirmation.ask({
      oldName,
      newName: name,
      title: title ?? `Update References to ${oldName}?`,
      confirmLabel: 'Update',
      files: confirmationFiles(edits.files, monaco, this.editors),
    });
  }

  /**
   * Applies what a rename changes in other files, saving the open ones when renames do.
   * @param edits The edits, keyed by the paths as they stand now.
   * @param monaco The Monaco instance, or undefined outside Electron.
   * @returns Returns a promise that resolves once they are applied.
   */
  private async apply(
    edits: WorkspaceTextEdits,
    monaco: typeof MonacoApi | undefined,
  ): Promise<void> {
    const outcome: WorkspaceEditOutcome = await this.applier.apply(edits, monaco);
    if (outcome.skipped.length > 0) {
      this.log.warn('rename', 'A rename left references it could not update', outcome.skipped);
    }
    if (!this.settings.get('textEditor.saveAfterRename')) {
      return;
    }
    for (const file of outcome.applied) {
      const id: string | undefined =
        file.where === 'editor' ? this.documents.findIdByPath(file.path) : undefined;
      if (id !== undefined) {
        await this.documents.save(id);
      }
    }
  }
}

/**
 * Reads a file's name without its last extension: the name of the type a C# file is named after.
 * @param name The file's name.
 * @returns Returns the name, or the whole name when it has no extension.
 */
function stem(name: string): string {
  const dot: number = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Builds the path of an entry beside another.
 * @param path The other entry's absolute path.
 * @param name The entry's name.
 * @returns Returns its absolute path.
 */
function sibling(path: string, name: string): string {
  const separator: number = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return `${path.slice(0, separator + 1)}${name}`;
}

/**
 * Joins the edits several answers make into one, keyed by file: a file several answers edit gets
 * each distinct edit once, since a type rename and a file rename can both change the same import.
 * @param answers The answers.
 * @returns Returns the edits.
 */
function mergeEdits(answers: readonly WorkspaceTextEdits[]): WorkspaceTextEdits {
  const byPath: Map<string, FileTextEdits> = new Map<string, FileTextEdits>();
  for (const file of answers.flatMap(
    (answer: WorkspaceTextEdits): readonly FileTextEdits[] => answer.files,
  )) {
    const existing: FileTextEdits | undefined = byPath.get(file.path);
    if (existing === undefined) {
      byPath.set(file.path, file);
      continue;
    }
    const seen: Set<string> = new Set<string>(existing.edits.map(editKey));
    byPath.set(file.path, {
      ...existing,
      edits: [
        ...existing.edits,
        ...file.edits.filter((edit: TextEditEntry): boolean => !seen.has(editKey(edit))),
      ],
    });
  }
  return {
    files: [...byPath.values()],
    refused: answers.flatMap(
      (answer: WorkspaceTextEdits): WorkspaceTextEdits['refused'] => answer.refused,
    ),
  };
}

/**
 * Identifies an edit by where it applies and what it writes, so the same edit is recognised twice.
 * @param edit The edit.
 * @returns Returns its key.
 */
function editKey(edit: TextEditEntry): string {
  const { startLineNumber, startColumn, endLineNumber, endColumn }: MonacoApi.IRange = edit.range;
  return `${startLineNumber}:${startColumn}-${endLineNumber}:${endColumn}=${edit.text}`;
}
