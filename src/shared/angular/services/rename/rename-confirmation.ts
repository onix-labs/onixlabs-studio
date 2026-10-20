import { Service, signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type { Editors } from '@shared/angular/services/editors/editors';
import type { FileTextEdits } from '@shared/angular/services/workspace-edit/workspace-edit';

/**
 * One file a rename across several files changes, as its confirmation lists it (#1015).
 */
export interface RenameConfirmationFile {
  /**
   * Gets the document, by path (or model URI), unique in the list.
   */
  readonly path: string;

  /**
   * Gets the file's name.
   */
  readonly name: string;

  /**
   * Gets the folder it is in, relative to the folder every listed file shares, or empty when it is
   * that folder.
   */
  readonly folder: string;

  /**
   * Gets how many places in it change.
   */
  readonly edits: number;

  /**
   * Gets whether it is open in an editor, where it changes unsaved, rather than on disk.
   */
  readonly open: boolean;
}

/**
 * Asks whether to rename a symbol across several files (#1015) — or to make another change across
 * several files, such as a code action's (#1016), which names its own question and answer.
 */
export interface RenameConfirmationRequest {
  /**
   * Gets the symbol's name as it stands.
   */
  readonly oldName: string;

  /**
   * Gets its new name.
   */
  readonly newName: string;

  /**
   * Gets the question the dialog asks, or undefined for a rename's ("Rename “a” to “b”?").
   */
  readonly title?: string;

  /**
   * Gets the label of the button that goes ahead, or undefined for a rename's ("Rename").
   */
  readonly confirmLabel?: string;

  /**
   * Gets the files it changes, in the order to list them.
   */
  readonly files: readonly RenameConfirmationFile[];
}

/**
 * Holds the one confirmation a rename across several files asks before anything changes (#1015): the
 * request the confirmation dialog shows, and the answer it gives. A rename in one file asks nothing —
 * the change is in front of the user, and one undo takes it back.
 *
 * One confirmation is open at a time; asking another answers the first no.
 */
@Service()
export class RenameConfirmation {
  /**
   * Holds the open request, or null when none is.
   */
  private readonly pendingState: WritableSignal<RenameConfirmationRequest | null> =
    signal<RenameConfirmationRequest | null>(null);

  /**
   * Gets the open request, or null when none is. Read by the confirmation dialog.
   */
  public readonly pending: Signal<RenameConfirmationRequest | null> =
    this.pendingState.asReadonly();

  /**
   * Answers the open request, or null when none is open.
   */
  private resolve: ((confirmed: boolean) => void) | null = null;

  /**
   * Asks whether to go ahead with a rename across several files.
   * @param request What the rename changes.
   * @returns Returns a promise resolving to true when the user goes ahead.
   */
  public ask(request: RenameConfirmationRequest): Promise<boolean> {
    this.answer(false);
    this.pendingState.set(request);
    return new Promise<boolean>((resolve: (confirmed: boolean) => void): void => {
      this.resolve = resolve;
    });
  }

  /**
   * Answers the open request, and closes it.
   * @param confirmed Whether to go ahead.
   */
  public answer(confirmed: boolean): void {
    const resolve: ((confirmed: boolean) => void) | null = this.resolve;
    this.resolve = null;
    this.pendingState.set(null);
    resolve?.(confirmed);
  }
}

/**
 * Lists the files a change across several files makes for its confirmation (#1015, #1016): each by
 * name, in the folder it is in below the one they all share, with how many places change and whether
 * it is open.
 * @param files The files and their edits.
 * @param monaco The Monaco instance whose models hold the open files, or undefined.
 * @param editors The editor registry, which knows the model each open file is shown through.
 * @returns Returns the files, in the change's order.
 */
export function confirmationFiles(
  files: readonly FileTextEdits[],
  monaco: typeof MonacoApi | undefined,
  editors: Editors,
): readonly RenameConfirmationFile[] {
  const models: ReadonlySet<string> = new Set<string>(
    (monaco?.editor.getModels() ?? []).map((model: MonacoApi.editor.ITextModel): string =>
      model.uri.toString(),
    ),
  );
  const shared: string = sharedFolder(files.map((file: FileTextEdits): string => file.path));
  return files.map((file: FileTextEdits): RenameConfirmationFile => {
    const slash: number = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'));
    const folder: string = slash < 0 ? '' : file.path.slice(0, slash);
    return {
      path: file.path,
      name: file.path.slice(slash + 1),
      folder: folder.length > shared.length ? folder.slice(shared.length + 1) : '',
      edits: file.edits.length,
      open: editors.modelUriForPath(file.path) !== undefined || models.has(file.path),
    };
  });
}

/**
 * Finds the folder every path shares: the longest run of whole folders they all start with.
 * @param paths The paths.
 * @returns Returns the folder, or empty when they share none.
 */
function sharedFolder(paths: readonly string[]): string {
  const folders: readonly string[][] = paths.map((path: string): string[] =>
    path.split(/[\\/]/).slice(0, -1),
  );
  const first: readonly string[] = folders[0] ?? [];
  let length: number = first.length;
  for (const folder of folders) {
    let index: number = 0;
    while (index < length && folder[index] === first[index]) {
      index++;
    }
    length = index;
  }
  return first.slice(0, length).join('/');
}
