/**
 * Names the file-system and file-dialog IPC channels, and the types their payloads carry. This is the
 * file capability's slice of the IPC contract: the shared file-system/file-watch clients and the
 * main-process file manager and watcher name their channels from here, over the generic
 * {@link import('./bridge').Bridge} transport. File access is shared plumbing (documents and their
 * file cone are shared kitchen), so this lives in `shared/api`.
 */
export enum FileChannel {
  /**
   * Reads a file from disk (renderer→main, invoke).
   */
  Read = 'file:read',

  /**
   * Writes contents to a file on disk (renderer→main, invoke).
   */
  Write = 'file:write',

  /**
   * Starts watching a file for on-disk changes (renderer→main, invoke).
   */
  Watch = 'file:watch',

  /**
   * Stops watching a file (renderer→main, invoke).
   */
  Unwatch = 'file:unwatch',

  /**
   * Notifies the renderer that a watched file changed on disk (main→renderer, send).
   */
  Changed = 'file:changed',

  /**
   * Shows an open-file dialog and reads the chosen file (renderer→main, invoke).
   */
  OpenFileDialog = 'dialog:open-file',

  /**
   * Shows an open-image dialog and returns the chosen path without reading it (renderer→main, invoke).
   */
  PickImage = 'dialog:pick-image',

  /**
   * Shows an open dialog for a single file or folder and returns the chosen path without reading it
   * (renderer→main, invoke).
   */
  PickPath = 'dialog:pick-path',

  /**
   * Shows a save-file dialog and returns the chosen path (renderer→main, invoke).
   */
  SaveFileDialog = 'dialog:save-file',

  /**
   * Shows an unsaved-changes confirmation dialog (renderer→main, invoke).
   */
  ConfirmSave = 'dialog:confirm-save',

  /**
   * Shows a destructive-action confirmation dialog and resolves whether the user confirmed
   * (renderer→main, invoke).
   */
  ConfirmDestructive = 'dialog:confirm-destructive',
}

/**
 * Describes a file read from disk.
 */
export interface FileInfo {
  /**
   * Gets the absolute path of the file.
   */
  readonly path: string;

  /**
   * Gets the file name, including its extension.
   */
  readonly name: string;

  /**
   * Gets the file extension, including the leading dot (empty when there is none).
   */
  readonly extension: string;

  /**
   * Gets the textual contents of the file, with any leading byte-order mark removed.
   */
  readonly content: string;

  /**
   * Gets the text encoding the file was read as (currently always "UTF-8"). Absent on file infos
   * synthesised outside the read path, where the consumer assumes UTF-8.
   */
  readonly encoding?: string;

  /**
   * Gets a value indicating whether the file began with a UTF-8 byte-order mark, so it can be
   * preserved when the file is written back. Absent (treated as false) on synthesised file infos.
   */
  readonly hasBom?: boolean;
}

/**
 * Describes the result of a file write.
 */
export interface FileWriteResult {
  /**
   * Gets a value indicating whether the write succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the absolute path written to, when successful.
   */
  readonly path?: string;

  /**
   * Gets the error message, when the write failed.
   */
  readonly error?: string;
}

/**
 * Identifies the user's choice in the unsaved-changes confirmation dialog.
 */
export type SaveDialogChoice = 'save' | 'dontSave' | 'cancel';

/**
 * Describes a destructive-action confirmation request: the dialog's title, the question, the
 * explanatory detail, and the label of the destructive (confirming) button.
 */
export interface ConfirmDestructiveRequest {
  /**
   * Gets the dialog title.
   */
  readonly title: string;

  /**
   * Gets the question shown as the dialog's message.
   */
  readonly message: string;

  /**
   * Gets the explanatory detail beneath the message.
   */
  readonly detail: string;

  /**
   * Gets the label of the destructive, confirming button (for example `Discard`).
   */
  readonly confirmLabel: string;
}
