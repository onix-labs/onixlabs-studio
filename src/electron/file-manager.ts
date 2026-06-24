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
import { IpcChannel } from '../shared/ipc-channels';
import { FileInfo, FileWriteResult, SaveDialogChoice } from '../shared/studio-api';

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
   * Initializes a new instance of the {@link FileManager} class.
   * @param windowGetter A function that returns the window the dialogs are parented to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the file-system IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      IpcChannel.FileRead,
      (_event: IpcMainInvokeEvent, filePath: unknown): Promise<FileInfo | null> =>
        this.read(filePath),
    );
    ipcMain.handle(
      IpcChannel.FileWrite,
      (_event: IpcMainInvokeEvent, filePath: unknown, content: unknown): Promise<FileWriteResult> =>
        this.write(filePath, content),
    );
    ipcMain.handle(IpcChannel.DialogOpenFile, (): Promise<FileInfo | null> => this.openDialog());
    ipcMain.handle(IpcChannel.DialogPickImage, (): Promise<string | null> => this.pickImage());
    ipcMain.handle(
      IpcChannel.DialogSaveFile,
      (_event: IpcMainInvokeEvent, defaultPath: unknown): Promise<string | null> =>
        this.saveDialog(typeof defaultPath === 'string' ? defaultPath : undefined),
    );
    ipcMain.handle(
      IpcChannel.DialogConfirmSave,
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
   * @returns Returns the result describing success or failure.
   */
  private async write(filePath: unknown, content: unknown): Promise<FileWriteResult> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return { success: false, error: 'Invalid file path' };
    }
    if (typeof content !== 'string') {
      return { success: false, error: 'Invalid file content' };
    }
    try {
      await fs.writeFile(filePath, content, 'utf-8');
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
    const content: string = await fs.readFile(filePath, 'utf-8');
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath),
      content,
    };
  }
}
