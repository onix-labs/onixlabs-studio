import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { FileOperationResult } from '@shared/api/workspace-channels';
import { Documents } from '@shared/angular/services/documents/documents';
import { Editors } from '@shared/angular/services/editors/editors';
import { Log } from '@shared/angular/services/log/log';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { basename } from '@shared/angular/services/lsp/lsp-paths';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  movedEdits,
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { confirmationFiles, RenameConfirmation } from './rename-confirmation';

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
   * Determines whether the edits are to be applied: there are some, and they change one file, or the
   * user is not asked, or says so.
   * @param edits The edits.
   * @param path The entry's path.
   * @param name Its new name.
   * @param monaco The Monaco instance, or undefined outside Electron.
   * @returns Returns a promise resolving to true when they are.
   */
  private async shouldFollow(
    edits: WorkspaceTextEdits,
    path: string,
    name: string,
    monaco: typeof MonacoApi | undefined,
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
      title: `Update References to ${oldName}?`,
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
