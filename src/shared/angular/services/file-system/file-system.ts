import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { Log } from '@shared/angular/services/log/log';
import {
  ConfirmDestructiveRequest,
  FileChannel,
  FileInfo,
  FileWriteResult,
  SaveDialogChoice,
} from '@shared/api/file-channels';

/**
 * Holds the result returned when a write is attempted outside Electron.
 */
const UNAVAILABLE_WRITE: FileWriteResult = {
  success: false,
  error: 'File access is only available when running inside Electron.',
};

/**
 * Represents the renderer-side file client: the typed wrapper around the file/dialog IPC channels,
 * driven over the generic {@link Bridge} transport (`window.bridge`). It is the file slice of the old
 * `window.studio`, naming its channels from the shared {@link FileChannel} contract.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the
 * bridge is absent and every operation degrades to a safe no-op so callers never throw.
 */
@Service()
export class FileSystem {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets a value indicating whether a real bridge is available (i.e. running in Electron).
   */
  public readonly isElectron: boolean = this.bridge !== undefined;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Reads a file from disk.
   * @param path The absolute path of the file to read.
   * @returns Returns the file info, or null when unavailable or unreadable.
   */
  public read(path: string): Promise<FileInfo | null> {
    return this.bridge?.invoke<FileInfo | null>(FileChannel.Read, path) ?? Promise.resolve(null);
  }

  /**
   * Writes contents to a file on disk.
   * @param path The absolute path to write to.
   * @param content The contents to write.
   * @param hasBom Whether to prefix the contents with a UTF-8 byte-order mark. Defaults to false.
   * @returns Returns the result describing success or failure.
   */
  public write(path: string, content: string, hasBom: boolean = false): Promise<FileWriteResult> {
    this.log.trace('FileSystem', 'Writing file', path);
    return (
      this.bridge?.invoke<FileWriteResult>(FileChannel.Write, path, content, hasBom) ??
      Promise.resolve(UNAVAILABLE_WRITE)
    );
  }

  /**
   * Shows an open-file dialog and reads the chosen file.
   * @returns Returns the chosen file's info, or null when cancelled or unavailable.
   */
  public openDialog(): Promise<FileInfo | null> {
    return (
      this.bridge?.invoke<FileInfo | null>(FileChannel.OpenFileDialog) ?? Promise.resolve(null)
    );
  }

  /**
   * Shows an open-image dialog and returns the chosen file's absolute path, without reading it.
   * @returns Returns the chosen image's absolute path, or null when cancelled or unavailable.
   */
  public pickImage(): Promise<string | null> {
    return this.bridge?.invoke<string | null>(FileChannel.PickImage) ?? Promise.resolve(null);
  }

  /**
   * Shows an open dialog for a single file or folder and returns the chosen absolute path, without
   * reading it.
   * @param kind Whether to pick a file or a folder.
   * @returns Returns the chosen path, or null when cancelled or unavailable.
   */
  public pickPath(kind: 'file' | 'folder'): Promise<string | null> {
    return this.bridge?.invoke<string | null>(FileChannel.PickPath, kind) ?? Promise.resolve(null);
  }

  /**
   * Shows a save-file dialog and returns the chosen path.
   * @param defaultPath The path suggested in the dialog.
   * @returns Returns the chosen path, or null when cancelled or unavailable.
   */
  public saveDialog(defaultPath?: string): Promise<string | null> {
    return (
      this.bridge?.invoke<string | null>(FileChannel.SaveFileDialog, defaultPath) ??
      Promise.resolve(null)
    );
  }

  /**
   * Shows a confirmation dialog asking whether to save unsaved changes.
   * @param fileName The name of the file with unsaved changes.
   * @returns Returns the user's choice; defaults to discarding when unavailable.
   */
  public confirmDestructive(request: ConfirmDestructiveRequest): Promise<boolean> {
    if (this.bridge === undefined) {
      return Promise.resolve(false);
    }
    return this.bridge.invoke<boolean>(FileChannel.ConfirmDestructive, request);
  }

  /**
   * Shows a confirmation dialog asking whether to save unsaved changes.
   * @param fileName The name of the file with unsaved changes.
   * @returns Returns the user's choice.
   */
  public confirmSave(fileName: string): Promise<SaveDialogChoice> {
    return (
      this.bridge?.invoke<SaveDialogChoice>(FileChannel.ConfirmSave, fileName) ??
      Promise.resolve('dontSave')
    );
  }
}
