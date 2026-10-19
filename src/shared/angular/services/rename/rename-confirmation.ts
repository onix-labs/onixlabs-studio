import { Service, signal, Signal, WritableSignal } from '@angular/core';

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
 * Asks whether to rename a symbol across several files (#1015).
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
