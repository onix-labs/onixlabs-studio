import {
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  MessageBoxReturnValue,
  OpenDialogReturnValue,
  SaveDialogReturnValue,
  WebContents,
} from 'electron';
import { showMessageBox, showOpenDialog, showSaveDialog } from './dialog-parent';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ConfirmDestructiveRequest,
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
   * Holds the function used to resolve the window dialogs fall back to when the requesting window
   * is gone.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the store of paths the user has opened or saved, so they can be re-opened later.
   */
  private readonly trusted: TrustedPaths;

  /**
   * Initializes a new instance of the {@link FileManager} class.
   * @param windowGetter A function that returns the window dialogs are parented to when the
   * requesting window is gone.
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
    ipcMain.handle(
      FileChannel.OpenFileDialog,
      (event: IpcMainInvokeEvent): Promise<FileInfo | null> => this.openDialog(event.sender),
    );
    ipcMain.handle(
      FileChannel.PickImage,
      (event: IpcMainInvokeEvent): Promise<string | null> => this.pickImage(event.sender),
    );
    ipcMain.handle(
      FileChannel.PickPath,
      (event: IpcMainInvokeEvent, kind: unknown): Promise<string | null> =>
        this.pickPath(event.sender, kind === 'folder' ? 'folder' : 'file'),
    );
    ipcMain.handle(
      FileChannel.SaveFileDialog,
      (event: IpcMainInvokeEvent, defaultPath: unknown): Promise<string | null> =>
        this.saveDialog(event.sender, typeof defaultPath === 'string' ? defaultPath : undefined),
    );
    ipcMain.handle(
      FileChannel.ConfirmSave,
      (event: IpcMainInvokeEvent, fileName: unknown): Promise<SaveDialogChoice> =>
        this.confirmSave(event.sender, typeof fileName === 'string' ? fileName : ''),
    );
    ipcMain.handle(
      FileChannel.ConfirmDestructive,
      (event: IpcMainInvokeEvent, request: unknown): Promise<boolean> =>
        this.confirmDestructive(event.sender, request),
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
   * @param sender The web contents that requested the dialog.
   * @returns Returns the chosen file's info, or null when cancelled or unreadable.
   */
  private async openDialog(sender: WebContents): Promise<FileInfo | null> {
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
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
   * @param sender The web contents that requested the dialog.
   * @returns Returns the chosen image's absolute path, or null when cancelled.
   */
  private async pickImage(sender: WebContents): Promise<string | null> {
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
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
   * @param sender The web contents that requested the dialog.
   * @param kind Whether to pick a file or a folder.
   * @returns Returns the chosen path, or null when cancelled.
   */
  private async pickPath(sender: WebContents, kind: 'file' | 'folder'): Promise<string | null> {
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }

  /**
   * Shows a save-file dialog and returns the chosen path.
   * @param sender The web contents that requested the dialog.
   * @param defaultPath The path suggested in the dialog.
   * @returns Returns the chosen path, or null when cancelled.
   */
  private async saveDialog(sender: WebContents, defaultPath?: string): Promise<string | null> {
    const result: SaveDialogReturnValue = await showSaveDialog(sender, this.windowGetter, {
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
   * @param sender The web contents that requested the dialog.
   * @param fileName The name of the file with unsaved changes.
   * @returns Returns the user's choice.
   */
  private async confirmSave(sender: WebContents, fileName: string): Promise<SaveDialogChoice> {
    const result: MessageBoxReturnValue = await showMessageBox(sender, this.windowGetter, {
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
   * Shows a destructive-action confirmation dialog. Cancel is the default and the escape action, so
   * a stray Return or Escape never confirms the destruction.
   * @param sender The web contents that requested the dialog.
   * @param request The dialog's title, message, detail, and confirm-button label.
   * @returns Returns true when the user explicitly confirmed.
   */
  private async confirmDestructive(sender: WebContents, request: unknown): Promise<boolean> {
    const candidate: Partial<ConfirmDestructiveRequest> = request ?? {};
    if (
      typeof candidate.title !== 'string' ||
      typeof candidate.message !== 'string' ||
      typeof candidate.detail !== 'string' ||
      typeof candidate.confirmLabel !== 'string'
    ) {
      return false;
    }
    const result: MessageBoxReturnValue = await showMessageBox(sender, this.windowGetter, {
      type: 'warning',
      buttons: [candidate.confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: candidate.title,
      message: candidate.message,
      detail: candidate.detail,
    });
    return result.response === 0;
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
