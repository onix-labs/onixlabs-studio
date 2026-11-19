import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Log } from '@shared/angular/services/log/log';
import { LspFeatures, LspRenameAnswer } from '@shared/angular/services/lsp/lsp-features';
import type { CodeSymbol } from '@shared/angular/services/lsp/lsp-symbols';
import type { WorkspaceTextEdits } from '@shared/angular/services/workspace-edit/workspace-edit';

/**
 * How long, in milliseconds, a file opened for the rename is waited on to reach an editor.
 */
const EDITOR_WAIT_MS: number = 3000;

/**
 * How often, in milliseconds, the editor is looked for while it is waited on.
 */
const EDITOR_POLL_MS: number = 50;

/**
 * The protocol's `SymbolKind`s that declare a type: class, interface, enum and struct.
 */
const TYPE_KINDS: ReadonlySet<number> = new Set<number>([5, 10, 11, 23]);

/**
 * Asks a language server for the edits that rename the type a file is named after — what renaming a
 * file with others nested beneath it does to the code, so `partial class Enumeration` in every one of
 * its files, and every use of it, follows the files to their new name.
 *
 * The server answers only for a document an editor has open, so a file that is not open is opened,
 * behind what the user is reading. Scoped beside the workspace it renames in.
 */
@Service()
export class TypeRename {
  /**
   * Holds the editor registry, which knows the model each open file is shown through.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the injector the opener and the language-server features are resolved from as they are
   * needed: both reach, through Monaco's commands, back to the renames.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Asks for the edits that rename the type a file declares under its own name.
   * @param path The absolute path of the file.
   * @param oldName The type's name: the file's name without its extension.
   * @param newName The name to give it.
   * @returns Returns the edits, or null when no server that renames serves the file, or it declares
   * no type of that name, or the server refused.
   */
  public async editsFor(
    path: string,
    oldName: string,
    newName: string,
  ): Promise<WorkspaceTextEdits | null> {
    const monaco: typeof MonacoApi | undefined = window.monaco;
    if (monaco === undefined || oldName === newName || !/^[A-Za-z_]\w*$/.test(newName)) {
      return null;
    }
    const model: MonacoApi.editor.ITextModel | null = await this.modelFor(monaco, path);
    if (model === null) {
      this.log.debug('rename', 'No editor for the type rename', path);
      return null;
    }
    const features: LspFeatures = this.injector.get(LspFeatures);
    const symbols: readonly CodeSymbol[] | null = await features.documentSymbols(model);
    const type: CodeSymbol | undefined = findType(symbols ?? [], oldName);
    if (type === undefined) {
      this.log.debug('rename', 'The file declares no type named after it', path);
      return null;
    }
    const answer: LspRenameAnswer | null = await features.rename(
      model,
      {
        lineNumber: type.selectionRange.start.line + 1,
        column: type.selectionRange.start.character + 1,
      },
      newName,
    );
    if (answer?.kind !== 'edits') {
      this.log.info('rename', 'The type rename was refused', answer?.reason ?? '');
      return null;
    }
    return answer.edits;
  }

  /**
   * Finds the editor model a file is shown through, opening the file when it is not open.
   * @param monaco The Monaco instance.
   * @param path The file.
   * @returns Returns the model, or null when the file could not be shown in an editor in time.
   */
  private async modelFor(
    monaco: typeof MonacoApi,
    path: string,
  ): Promise<MonacoApi.editor.ITextModel | null> {
    if (this.editors.modelUriForPath(path) === undefined) {
      const opened: boolean = await this.injector
        .get(FileOpener)
        .openPath(path, { background: true });
      if (!opened) {
        return null;
      }
    }
    for (let waited: number = 0; waited <= EDITOR_WAIT_MS; waited += EDITOR_POLL_MS) {
      const uri: string | undefined = this.editors.modelUriForPath(path);
      const model: MonacoApi.editor.ITextModel | null =
        uri === undefined ? null : monaco.editor.getModel(monaco.Uri.parse(uri));
      if (model !== null) {
        return model;
      }
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, EDITOR_POLL_MS);
      });
    }
    return null;
  }
}

/**
 * Finds the first type of a name among a document's symbols, at any depth — inside a namespace, say.
 * A generic type is reported with its parameters (`Enumeration<T>`), which the name does not carry.
 * @param symbols The symbols.
 * @param name The type's name.
 * @returns Returns the type, or undefined when there is none.
 */
function findType(symbols: readonly CodeSymbol[], name: string): CodeSymbol | undefined {
  for (const symbol of symbols) {
    if (TYPE_KINDS.has(symbol.kind) && symbol.name.replace(/<.*$/, '') === name) {
      return symbol;
    }
    const nested: CodeSymbol | undefined = findType(symbol.children, name);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}
