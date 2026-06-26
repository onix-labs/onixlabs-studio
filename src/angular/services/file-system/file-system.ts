import { Service } from '@angular/core';
import { FileApi, FileInfo, FileWriteResult, SaveDialogChoice } from '../../../shared/studio-api';

/**
 * Holds the result returned when a write is attempted outside Electron.
 */
const UNAVAILABLE_WRITE: FileWriteResult = {
  success: false,
  error: 'File access is only available when running inside Electron.',
};

/**
 * Represents the renderer-side wrapper around the Electron file bridge exposed on
 * `window.studio.file`.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the
 * bridge is absent and every operation degrades to a safe no-op so callers never throw.
 */
@Service()
export class FileSystem {
  /**
   * Holds the file bridge, or undefined when running outside Electron.
   */
  private readonly api: FileApi | undefined = window.studio?.file;

  /**
   * Gets a value indicating whether a real file bridge is available (i.e. running in Electron).
   */
  public readonly isElectron: boolean = this.api !== undefined;

  /**
   * Reads a file from disk.
   * @param path The absolute path of the file to read.
   * @returns Returns the file info, or null when unavailable or unreadable.
   */
  public read(path: string): Promise<FileInfo | null> {
    return this.api?.read(path) ?? Promise.resolve(null);
  }

  /**
   * Writes contents to a file on disk.
   * @param path The absolute path to write to.
   * @param content The contents to write.
   * @param hasBom Whether to prefix the contents with a UTF-8 byte-order mark. Defaults to false.
   * @returns Returns the result describing success or failure.
   */
  public write(path: string, content: string, hasBom: boolean = false): Promise<FileWriteResult> {
    return this.api?.write(path, content, hasBom) ?? Promise.resolve(UNAVAILABLE_WRITE);
  }

  /**
   * Shows an open-file dialog and reads the chosen file.
   * @returns Returns the chosen file's info, or null when cancelled or unavailable.
   */
  public openDialog(): Promise<FileInfo | null> {
    return this.api?.openDialog() ?? Promise.resolve(null);
  }

  /**
   * Shows a save-file dialog and returns the chosen path.
   * @param defaultPath The path suggested in the dialog.
   * @returns Returns the chosen path, or null when cancelled or unavailable.
   */
  public saveDialog(defaultPath?: string): Promise<string | null> {
    return this.api?.saveDialog(defaultPath) ?? Promise.resolve(null);
  }

  /**
   * Shows a confirmation dialog asking whether to save unsaved changes.
   * @param fileName The name of the file with unsaved changes.
   * @returns Returns the user's choice; defaults to discarding when unavailable.
   */
  public confirmSave(fileName: string): Promise<SaveDialogChoice> {
    return this.api?.confirmSave(fileName) ?? Promise.resolve('dontSave');
  }
}
