import { inject, Injector, Service } from '@angular/core';
import { Editors } from '@shared/angular/services/editors/editors';
import { Log } from '@shared/angular/services/log/log';
import { LspCodeAction, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { CodeSymbol, SymbolKind } from '@shared/angular/services/lsp/lsp-symbols';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import {
  confirmationFiles,
  RenameConfirmation,
} from '@shared/angular/services/rename/rename-confirmation';
import {
  SkippedEdit,
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';

/**
 * How long to wait before each look for the server's rename, in milliseconds. The server learns of
 * the renamed file from the file watcher, then re-reads its project: until it has, the file is a
 * stranger to it and it offers nothing (Roslyn 5.13 needed about three seconds for the fixture).
 */
export const RENAME_TYPE_SETTLE_DELAYS_MS: readonly number[] = [500, 1000, 1500, 2000, 2500, 3000];

/**
 * The kinds of symbol a file can be named after.
 */
const TYPE_KINDS: ReadonlySet<number> = new Set<number>([
  SymbolKind.Class,
  SymbolKind.Interface,
  SymbolKind.Struct,
  SymbolKind.Enum,
]);

/**
 * The kinds of symbol a file's type may be declared inside: a namespace, and its kin.
 */
const CONTAINER_KINDS: ReadonlySet<number> = new Set<number>([
  SymbolKind.File,
  SymbolKind.Module,
  SymbolKind.Namespace,
  SymbolKind.Package,
]);

/**
 * Holds the key every notification of this is raised under, so a newer one replaces an older one.
 */
const NOTIFICATION_KEY: string = 'rename-type-with-file';

/**
 * A type name a file rename implies: the file's old name and its new one, without the extension.
 */
export interface TypeNameChange {
  /**
   * Gets the name the type is expected to have now, the file's old name.
   */
  readonly oldName: string;

  /**
   * Gets the name the file now asks it to have.
   */
  readonly newName: string;
}

/**
 * Offers to rename a file's type with the file (#1152): after a file is renamed in an explorer from
 * `IGreeter.cs` to `Greeter.cs`, and it still declares `IGreeter`, the language server is asked for
 * the refactoring that renames the type to match — Roslyn's "Rename type to Greeter", which changes
 * every use of it across the solution. Its edit is offered through the confirmation a rename across
 * files asks, listing the files it changes; going ahead applies it as a rename's edit is applied (open
 * files in their editors, unsaved; the rest on disk), and not going ahead leaves the file renamed
 * alone.
 *
 * The question is put to the language server rather than worked out here: whether a file is named
 * after a type, and what renaming it changes, is the language's to say, and a server that offers no
 * such refactoring is simply left alone — nothing is said. Only the C# server offers one today.
 */
@Service()
export class RenameTypeWithFile {
  /**
   * Holds the confirmation the edit is offered through, which a rename across files asks too.
   */
  private readonly confirmation: RenameConfirmation = inject(RenameConfirmation);

  /**
   * Holds the applier the edit goes through.
   */
  private readonly applier: WorkspaceEditApplier = inject(WorkspaceEditApplier);

  /**
   * Holds the editor registry, which knows the files open in editors.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the Monaco service, whose models hold the open files.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the notifications anything not applied is told through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the injector the language-server features are resolved from as they are needed, as the
   * other users of them do: they reach into Monaco, which is loaded on demand.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the rename being looked into: a newer one abandons an older one's look.
   */
  private current: symbol | null = null;

  /**
   * Offers to rename the type a renamed file is named after, when the file's language server offers
   * to. Does nothing — and says nothing — when the rename implies no type name, the file declares no
   * type of its old name, or the server offers no such rename.
   * @param oldPath The file's absolute path before the rename.
   * @param newPath Its absolute path after.
   * @returns Returns a promise that resolves once the rename is applied, declined or found not to
   * apply.
   */
  public async offer(oldPath: string, newPath: string): Promise<void> {
    const change: TypeNameChange | null = typeNameChange(oldPath, newPath);
    if (change === null || !this.injector.get(LspFeatures).servesFileCodeActions(newPath)) {
      return;
    }
    const token: symbol = Symbol(newPath);
    this.current = token;
    const action: LspCodeAction | null = await this.findAction(newPath, change, token);
    if (action === null || this.current !== token) {
      return;
    }
    const features: LspFeatures = this.injector.get(LspFeatures);
    const resolved: LspCodeAction = await features.resolveFileCodeAction(newPath, action);
    const edit: WorkspaceTextEdits | null = resolved.edit;
    if (this.current !== token || edit === null || edit.files.length === 0) {
      this.log.debug('renameType', 'The rename came back with no edit', resolved.title);
      return;
    }
    this.current = null;
    this.log.info('renameType', `Offering “${resolved.title}”`, `${edit.files.length} file(s)`);
    const confirmed: boolean = await this.confirmation.ask({
      oldName: change.oldName,
      newName: change.newName,
      title: `${resolved.title}?`,
      confirmLabel: 'Rename Type',
      cancelLabel: 'Rename File Only',
      files: confirmationFiles(edit.files, this.monaco.getMonaco(), this.editors),
    });
    if (!confirmed) {
      this.log.debug('renameType', 'Kept the file rename only');
      return;
    }
    const outcome: WorkspaceEditOutcome = await this.applier.apply(edit);
    this.report(resolved.title, edit.files.length, outcome);
  }

  /**
   * Looks for the server's rename of a renamed file's type, asking again while the server catches up
   * with the rename: the file's symbols, for where its type is declared, then the refactorings there.
   * @param path The file's new path.
   * @param change The type name the rename implies.
   * @param token The rename being looked into, whose look stops when a newer one starts.
   * @returns Returns the rename, or null when the file declares no such type, no server knows the
   * file, or none was offered in time.
   */
  private async findAction(
    path: string,
    change: TypeNameChange,
    token: symbol,
  ): Promise<LspCodeAction | null> {
    const features: LspFeatures = this.injector.get(LspFeatures);
    for (const delay of RENAME_TYPE_SETTLE_DELAYS_MS) {
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, delay));
      if (this.current !== token) {
        return null;
      }
      const symbols: readonly CodeSymbol[] | null = await features.fileSymbols(path);
      const type: CodeSymbol | null = symbols === null ? null : typeNamed(symbols, change.oldName);
      if (symbols !== null && symbols.length > 0 && type === null) {
        this.log.debug('renameType', `The file declares no type “${change.oldName}”`, path);
        return null;
      }
      if (type === null) {
        continue;
      }
      const at: CodeSymbol['selectionRange']['start'] = type.selectionRange.start;
      const actions: readonly LspCodeAction[] | null = await features.fileCodeActions(
        path,
        {
          startLineNumber: at.line + 1,
          startColumn: at.character + 1,
          endLineNumber: at.line + 1,
          endColumn: at.character + 1,
        },
        ['refactor'],
      );
      if (actions === null) {
        // No server that offers code actions knows the file: asking again changes nothing.
        return null;
      }
      const action: LspCodeAction | null = renameTypeAction(actions, change);
      if (action !== null) {
        return action;
      }
    }
    this.log.debug('renameType', 'No rename of the type was offered', path);
    return null;
  }

  /**
   * Tells the user what of the rename was not applied, if anything; a rename applied whole is in
   * front of them, and says nothing.
   * @param title The rename's title.
   * @param fileCount How many files it was to change.
   * @param outcome What applying it did.
   */
  private report(title: string, fileCount: number, outcome: WorkspaceEditOutcome): void {
    this.log.info(
      'renameType',
      `Applied “${title}” to ${outcome.applied.length} of ${fileCount} file(s)`,
      outcome.skipped.length > 0 ? `${outcome.skipped.length} skipped` : '',
    );
    if (outcome.skipped.length === 0) {
      return;
    }
    this.notifications.notify({
      severity: 'warning',
      title:
        outcome.applied.length === 0
          ? `Couldn't apply “${title}”`
          : `Applied “${title}” in ${outcome.applied.length} of ${fileCount} files`,
      detail: outcome.skipped
        .map((skipped: SkippedEdit): string =>
          skipped.path.length === 0
            ? skipped.reason
            : `${skipped.path.slice(Math.max(skipped.path.lastIndexOf('/'), skipped.path.lastIndexOf('\\')) + 1)} — ${skipped.reason}`,
        )
        .join('\n'),
      sticky: true,
      key: NOTIFICATION_KEY,
    });
  }
}

/**
 * Works out the type name a file rename implies: the file's old and new names without their shared
 * extension, when both are identifiers and differ. A file moved to another folder, given another
 * extension, or named with more than one dot (`Form1.Designer.cs`) implies none.
 * @param oldPath The file's absolute path before the rename.
 * @param newPath Its absolute path after.
 * @returns Returns the old and new names, or null when the rename implies no type name.
 */
export function typeNameChange(oldPath: string, newPath: string): TypeNameChange | null {
  const before: PathParts = splitPath(oldPath);
  const after: PathParts = splitPath(newPath);
  if (
    before.folder !== after.folder ||
    before.extension.length === 0 ||
    before.extension !== after.extension ||
    before.stem === after.stem ||
    !isIdentifier(before.stem) ||
    !isIdentifier(after.stem)
  ) {
    return null;
  }
  return { oldName: before.stem, newName: after.stem };
}

/**
 * A path in parts.
 */
interface PathParts {
  /**
   * Gets the folder, with its trailing separator.
   */
  readonly folder: string;

  /**
   * Gets the name without its extension.
   */
  readonly stem: string;

  /**
   * Gets the extension, with its dot, or empty for none.
   */
  readonly extension: string;
}

/**
 * Splits a path into its folder, its name's stem and its extension.
 * @param path The path.
 * @returns Returns its parts.
 */
function splitPath(path: string): PathParts {
  const slash: number = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name: string = path.slice(slash + 1);
  const dot: number = name.lastIndexOf('.');
  return {
    folder: path.slice(0, slash + 1),
    stem: dot <= 0 ? name : name.slice(0, dot),
    extension: dot <= 0 ? '' : name.slice(dot),
  };
}

/**
 * Determines whether a name can name a type in the languages that name files after types: letters,
 * digits and underscores, not starting with a digit.
 * @param name The name.
 * @returns Returns true when it is an identifier.
 */
export function isIdentifier(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name);
}

/**
 * Finds the type a file declares by a name: at its top level, or inside its namespaces — not a type
 * nested in another, which a file is not named after. A generic type matches by its name alone
 * (`Repository<T>` is `Repository`).
 * @param symbols The file's top-level symbols.
 * @param name The type's name.
 * @returns Returns the first such type in the file, or null when it declares none.
 */
export function typeNamed(symbols: readonly CodeSymbol[], name: string): CodeSymbol | null {
  for (const symbol of symbols) {
    const bare: string = symbol.name.replace(/\s*[<(].*$/, '');
    if (TYPE_KINDS.has(symbol.kind) && bare === name) {
      return symbol;
    }
    if (CONTAINER_KINDS.has(symbol.kind)) {
      const nested: CodeSymbol | null = typeNamed(symbol.children, name);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

/**
 * Chooses, among the refactorings a server offers at a renamed file's type, the one that renames the
 * type to the file's new name. Roslyn's is "Rename type to Greeter", offered beside "Rename file to
 * IGreeter.cs", which undoes the rename instead — so the choice is a refactoring that names the new
 * name and not the old one, preferring the one titled as a type rename when several do.
 * @param actions The refactorings offered.
 * @param change The type name the rename implies.
 * @returns Returns the rename, or null when none is offered.
 */
export function renameTypeAction(
  actions: readonly LspCodeAction[],
  change: TypeNameChange,
): LspCodeAction | null {
  const candidates: readonly LspCodeAction[] = actions.filter(
    (action: LspCodeAction): boolean =>
      action.disabledReason === null &&
      (action.kind === 'refactor' || action.kind.startsWith('refactor.')) &&
      action.children === undefined &&
      names(action.title, change.newName) &&
      !names(action.title, change.oldName),
  );
  return (
    candidates.find((action: LspCodeAction): boolean => /^rename type\b/i.test(action.title)) ??
    (candidates.length === 1 ? candidates[0] : null)
  );
}

/**
 * Determines whether a title names a name as a whole word: `Greeter` in "Rename type to Greeter", but
 * not in "Rename file to IGreeter.cs".
 * @param title The title.
 * @param name The name.
 * @returns Returns true when it does.
 */
function names(title: string, name: string): boolean {
  const escaped: string = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u').test(title);
}
