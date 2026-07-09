import {
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  MessageBoxReturnValue,
  OpenDialogReturnValue,
  SaveDialogReturnValue,
} from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  FileChannel,
  FileInfo,
  FileWriteResult,
  SaveDialogChoice,
} from '@shared/api/file-channels';
import { TrustedPaths } from '@shared/electron/trusted-paths';

/**
 * Specifies the UTF-8 byte-order mark, as a string (U+FEFF). Detected and stripped on read, and
 * re-added on write, so a file's BOM is preserved across edits.
 */
const UTF8_BOM: string = String.fromCharCode(0xfeff);

/**
 * Specifies the encoding label reported for text files. Only UTF-8 is supported for now.
 */
const UTF8_ENCODING: string = 'UTF-8';

/**
 * Specifies the index of the "Save" button in the confirm-save dialog.
 */
const SAVE_BUTTON_INDEX: number = 0;

/**
 * Specifies the index of the "Don't Save" button in the confirm-save dialog.
 */
const DONT_SAVE_BUTTON_INDEX: number = 1;

/**
 * Specifies the index of the "Cancel" button in the confirm-save dialog.
 */
const CANCEL_BUTTON_INDEX: number = 2;

/**
 * Handles file-system operations on behalf of the renderer: reads and writes files, and shows the
 * open, save, and unsaved-changes dialogs. All paths are validated here before any disk access.
 */
export class FileManager {
  /**
   * Holds the function used to resolve the window that owns the dialogs.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the store of paths the user has opened or saved, so they can be re-opened later.
   */
  private readonly trusted: TrustedPaths;

  /**
   * Initializes a new instance of the {@link FileManager} class.
   * @param windowGetter A function that returns the window the dialogs are parented to.
   * @param trusted The store used to remember files chosen through the save dialog.
   */
  public constructor(windowGetter: () => BrowserWindow | null, trusted: TrustedPaths) {
    this.windowGetter = windowGetter;
    this.trusted = trusted;
  }

  /**
   * Registers the file-system IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      FileChannel.Read,
      (_event: IpcMainInvokeEvent, filePath: unknown): Promise<FileInfo | null> =>
        this.read(filePath),
    );
    ipcMain.handle(
      FileChannel.Write,
      (
        _event: IpcMainInvokeEvent,
        filePath: unknown,
        content: unknown,
        hasBom: unknown,
      ): Promise<FileWriteResult> => this.write(filePath, content, hasBom === true),
    );
    ipcMain.handle(FileChannel.OpenFileDialog, (): Promise<FileInfo | null> => this.openDialog());
    ipcMain.handle(FileChannel.PickImage, (): Promise<string | null> => this.pickImage());
    ipcMain.handle(
      FileChannel.PickPath,
      (_event: IpcMainInvokeEvent, kind: unknown): Promise<string | null> =>
        this.pickPath(kind === 'folder' ? 'folder' : 'file'),
    );
    ipcMain.handle(
      FileChannel.SaveFileDialog,
      (_event: IpcMainInvokeEvent, defaultPath: unknown): Promise<string | null> =>
        this.saveDialog(typeof defaultPath === 'string' ? defaultPath : undefined),
    );
    ipcMain.handle(
      FileChannel.ConfirmSave,
      (_event: IpcMainInvokeEvent, fileName: unknown): Promise<SaveDialogChoice> =>
        this.confirmSave(typeof fileName === 'string' ? fileName : ''),
    );
  }

  /**
   * Reads a file from disk after validating the path.
   * @param filePath The path to read.
   * @returns Returns the file info, or null when the path is invalid or the read fails.
   */
  private async read(filePath: unknown): Promise<FileInfo | null> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return null;
    }
    try {
      return await this.readFileInfo(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Writes contents to a file after validating the arguments.
   * @param filePath The path to write to.
   * @param content The contents to write.
   * @param hasBom Whether to prefix the contents with a UTF-8 byte-order mark.
   * @returns Returns the result describing success or failure.
   */
  private async write(
    filePath: unknown,
    content: unknown,
    hasBom: boolean,
  ): Promise<FileWriteResult> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return { success: false, error: 'Invalid file path' };
    }
    if (typeof content !== 'string') {
      return { success: false, error: 'Invalid file content' };
    }
    try {
      // Re-add the byte-order mark the file was read with, so a BOM is preserved across edits.
      await fs.writeFile(filePath, hasBom ? UTF8_BOM + content : content, 'utf-8');
      return { success: true, path: filePath };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Shows an open-file dialog and reads the chosen file.
   * @returns Returns the chosen file's info, or null when cancelled or unreadable.
   */
  private async openDialog(): Promise<FileInfo | null> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return null;
    }
    const result: OpenDialogReturnValue = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    try {
      return await this.readFileInfo(result.filePaths[0]);
    } catch {
      return null;
    }
  }

  /**
   * Shows an open-image dialog and returns the chosen file's path, without reading its contents.
   * @returns Returns the chosen image's absolute path, or null when cancelled.
   */
  private async pickImage(): Promise<string | null> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return null;
    }
    const result: OpenDialogReturnValue = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }

  /**
   * Shows an open dialog for a single file or folder and returns the chosen path, without reading its
   * contents. Used to attach context to an agent conversation.
   * @param kind Whether to pick a file or a folder.
   * @returns Returns the chosen path, or null when cancelled.
   */
  private async pickPath(kind: 'file' | 'folder'): Promise<string | null> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return null;
    }
    const result: OpenDialogReturnValue = await dialog.showOpenDialog(window, {
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }

  /**
   * Shows a save-file dialog and returns the chosen path.
   * @param defaultPath The path suggested in the dialog.
   * @returns Returns the chosen path, or null when cancelled.
   */
  private async saveDialog(defaultPath?: string): Promise<string | null> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return null;
    }
    const result: SaveDialogReturnValue = await dialog.showSaveDialog(window, {
      defaultPath,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
      return null;
    }
    // Remember the chosen path so the saved file can be re-opened from the welcome screen later.
    this.trusted.remember(result.filePath);
    return result.filePath;
  }

  /**
   * Shows a confirmation dialog asking whether to save unsaved changes.
   * @param fileName The name of the file with unsaved changes.
   * @returns Returns the user's choice.
   */
  private async confirmSave(fileName: string): Promise<SaveDialogChoice> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return 'cancel';
    }
    const result: MessageBoxReturnValue = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: SAVE_BUTTON_INDEX,
      cancelId: CANCEL_BUTTON_INDEX,
      title: 'Unsaved Changes',
      message: `Do you want to save changes to "${fileName}"?`,
      detail: "Your changes will be lost if you don't save them.",
    });
    if (result.response === SAVE_BUTTON_INDEX) {
      return 'save';
    }
    if (result.response === DONT_SAVE_BUTTON_INDEX) {
      return 'dontSave';
    }
    return 'cancel';
  }

  /**
   * Reads a file and builds its {@link FileInfo}.
   * @param filePath The path to read.
   * @returns Returns the file info.
   */
  private async readFileInfo(filePath: string): Promise<FileInfo> {
    const raw: string = await fs.readFile(filePath, 'utf-8');
    // A UTF-8 BOM decodes to a leading U+FEFF; strip it from the content but record its presence so
    // it can be written back, and so the editor never shows the mark as an invisible character.
    const hasBom: boolean = raw.charCodeAt(0) === 0xfeff;
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath),
      content: hasBom ? raw.slice(1) : raw,
      encoding: UTF8_ENCODING,
      hasBom,
    };
  }
}
