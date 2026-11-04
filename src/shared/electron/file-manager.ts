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
import { logger } from './logger';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ConfirmDestructiveRequest,
  FileChannel,
  FileInfo,
  FileWriteResult,
  SaveDialogChoice,
} from '@shared/api/file-channels';
import {
  isTextEncoding,
  textDecodeOptions,
  type TextDecodeOptions,
  type TextEncoding,
} from '@shared/api/text-encodings';
import { TrustedPaths } from '@shared/electron/trusted-paths';
import { decodeText, encodeText, type DecodedText } from '@shared/electron/text-encoding';

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
    logger.info('FileManager', 'Registering file IPC handlers');
    ipcMain.handle(
      FileChannel.Read,
      (_event: IpcMainInvokeEvent, filePath: unknown, decode: unknown): Promise<FileInfo | null> =>
        this.read(filePath, textDecodeOptions(decode)),
    );
    ipcMain.handle(
      FileChannel.Write,
      (
        _event: IpcMainInvokeEvent,
        filePath: unknown,
        content: unknown,
        hasBom: unknown,
        encoding: unknown,
      ): Promise<FileWriteResult> =>
        // An encoding not understood writes UTF-8, as every write did before encodings (#1236).
        this.write(
          filePath,
          content,
          hasBom === true,
          isTextEncoding(encoding) ? encoding : 'utf8',
        ),
    );
    ipcMain.handle(
      FileChannel.WriteBytes,
      (_event: IpcMainInvokeEvent, filePath: unknown, bytes: unknown): Promise<FileWriteResult> =>
        this.writeBytes(filePath, bytes),
    );
    ipcMain.handle(
      FileChannel.OpenFileDialog,
      (event: IpcMainInvokeEvent, decode: unknown): Promise<readonly FileInfo[]> =>
        this.openDialog(event.sender, textDecodeOptions(decode)),
    );
    ipcMain.handle(FileChannel.PickImage, (event: IpcMainInvokeEvent): Promise<string | null> =>
      this.pickImage(event.sender),
    );
    ipcMain.handle(
      FileChannel.PickPath,
      (event: IpcMainInvokeEvent, kind: unknown, multiple: unknown): Promise<readonly string[]> =>
        this.pickPaths(event.sender, kind === 'folder' ? 'folder' : 'file', multiple === true),
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
   * @param decode How to decode its bytes.
   * @returns Returns the file info, or null when the path is invalid or the read fails.
   */
  private async read(filePath: unknown, decode: TextDecodeOptions): Promise<FileInfo | null> {
    logger.trace('FileManager.read', `Read requested for ${String(filePath)}`);
    if (typeof filePath !== 'string' || filePath.length === 0) {
      logger.warn('FileManager.read', 'Rejected read for invalid path');
      return null;
    }
    try {
      const info: FileInfo = await this.readFileInfo(filePath, decode);
      logger.trace('FileManager.read', `Read ${filePath} (${info.content.length} chars)`);
      return info;
    } catch (error: unknown) {
      logger.error('FileManager.read', `Failed to read ${filePath}`, error);
      return null;
    }
  }

  /**
   * Writes contents to a file after validating the arguments.
   * @param filePath The path to write to.
   * @param content The contents to write.
   * @param hasBom Whether to prefix the contents with the encoding's byte-order mark.
   * @param encoding The encoding to write in.
   * @returns Returns the result describing success or failure.
   */
  private async write(
    filePath: unknown,
    content: unknown,
    hasBom: boolean,
    encoding: TextEncoding,
  ): Promise<FileWriteResult> {
    logger.trace('FileManager.write', `Write requested for ${String(filePath)} (hasBom=${hasBom})`);
    if (typeof filePath !== 'string' || filePath.length === 0) {
      logger.warn('FileManager.write', 'Rejected write for invalid path');
      return { success: false, error: 'Invalid file path' };
    }
    if (typeof content !== 'string') {
      logger.warn('FileManager.write', `Rejected write for ${filePath}: invalid content`);
      return { success: false, error: 'Invalid file content' };
    }
    let bytes: Buffer;
    try {
      // Re-add the byte-order mark the file was read with, so a BOM is preserved across edits.
      bytes = encodeText(content, encoding, hasBom);
    } catch (error: unknown) {
      // A character the encoding cannot hold: refused, so nothing is lost on disk.
      logger.warn('FileManager.write', `Refused ${filePath}: not encodable in ${encoding}`);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
    try {
      await fs.writeFile(filePath, bytes);
      logger.info('FileManager', `Saved ${filePath}`);
      return { success: true, path: filePath };
    } catch (error: unknown) {
      logger.error('FileManager', `Failed to save ${filePath}`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Writes bytes to a file, as {@link write} writes text: to the path the renderer names, which is one
   * the user chose in a save dialog.
   * @param filePath The path to write.
   * @param bytes The bytes.
   * @returns Returns a promise resolving whether it was written, and why not.
   */
  private async writeBytes(filePath: unknown, bytes: unknown): Promise<FileWriteResult> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      logger.warn('FileManager.writeBytes', 'Rejected write for invalid path');
      return { success: false, error: 'Invalid file path' };
    }
    if (!(bytes instanceof Uint8Array)) {
      logger.warn('FileManager.writeBytes', `Rejected write for ${filePath}: invalid content`);
      return { success: false, error: 'Invalid file content' };
    }
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, bytes);
      logger.info('FileManager', `Wrote ${bytes.byteLength} bytes to ${filePath}`);
      return { success: true, path: filePath };
    } catch (error: unknown) {
      logger.error('FileManager', `Failed to write ${filePath}`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Shows an open-file dialog and reads every chosen file.
   * @param sender The web contents that requested the dialog.
   * @param decode How to decode the chosen files' bytes.
   * @returns Returns the chosen files' info, empty when cancelled. A file that cannot be read is
   * skipped rather than failing the whole selection: one unreadable file among ten should not lose the
   * other nine.
   */
  private async openDialog(
    sender: WebContents,
    decode: TextDecodeOptions,
  ): Promise<readonly FileInfo[]> {
    logger.trace('FileManager.openDialog', 'Open-file dialog requested');
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      logger.trace('FileManager.openDialog', 'Open-file dialog cancelled');
      return [];
    }
    logger.debug('FileManager.openDialog', `Chosen ${result.filePaths.length} file(s)`);
    const opened: FileInfo[] = [];
    for (const filePath of result.filePaths) {
      try {
        opened.push(await this.readFileInfo(filePath, decode));
      } catch (error: unknown) {
        logger.error('FileManager.openDialog', `Failed to read chosen file ${filePath}`, error);
      }
    }
    return opened;
  }

  /**
   * Shows an open-image dialog and returns the chosen file's path, without reading its contents.
   * @param sender The web contents that requested the dialog.
   * @returns Returns the chosen image's absolute path, or null when cancelled.
   */
  private async pickImage(sender: WebContents): Promise<string | null> {
    logger.trace('FileManager.pickImage', 'Pick-image dialog requested');
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      logger.trace('FileManager.pickImage', 'Pick-image dialog cancelled');
      return null;
    }
    logger.debug('FileManager.pickImage', `Chosen image ${result.filePaths[0]}`);
    return result.filePaths[0];
  }

  /**
   * Shows an open dialog for files or a folder and returns the chosen paths, without reading their
   * contents. Used to attach context to an agent conversation.
   *
   * Folders are always single: multi-select is possible for directories but nothing asks for it, and it
   * complicates what attaching several roots to one conversation would mean.
   * @param sender The web contents that requested the dialog.
   * @param kind Whether to pick files or a folder.
   * @param multiple Whether the file dialog accepts more than one selection.
   * @returns Returns the chosen paths, empty when cancelled.
   */
  private async pickPaths(
    sender: WebContents,
    kind: 'file' | 'folder',
    multiple: boolean,
  ): Promise<readonly string[]> {
    logger.trace('FileManager.pickPaths', `Pick-${kind} dialog requested (multiple: ${multiple})`);
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
      properties:
        kind === 'folder'
          ? ['openDirectory']
          : multiple
            ? ['openFile', 'multiSelections']
            : ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      logger.trace('FileManager.pickPaths', `Pick-${kind} dialog cancelled`);
      return [];
    }
    logger.debug('FileManager.pickPaths', `Chosen ${result.filePaths.length} ${kind}(s)`);
    return result.filePaths;
  }

  /**
   * Shows a save-file dialog and returns the chosen path.
   * @param sender The web contents that requested the dialog.
   * @param defaultPath The path suggested in the dialog.
   * @returns Returns the chosen path, or null when cancelled.
   */
  private async saveDialog(sender: WebContents, defaultPath?: string): Promise<string | null> {
    logger.trace(
      'FileManager.saveDialog',
      `Save dialog requested (defaultPath=${String(defaultPath)})`,
    );
    const result: SaveDialogReturnValue = await showSaveDialog(sender, this.windowGetter, {
      defaultPath,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
      logger.trace('FileManager.saveDialog', 'Save dialog cancelled');
      return null;
    }
    // Remember the chosen path so the saved file can be re-opened from the welcome screen later.
    logger.debug('FileManager.saveDialog', `Chosen save path ${result.filePath}`);
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
    logger.trace('FileManager.confirmSave', `Confirm-save prompt for "${fileName}"`);
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
    logger.trace('FileManager.confirmDestructive', 'Confirm-destructive prompt requested');
    const candidate: Partial<ConfirmDestructiveRequest> = request ?? {};
    if (
      typeof candidate.title !== 'string' ||
      typeof candidate.message !== 'string' ||
      typeof candidate.detail !== 'string' ||
      typeof candidate.confirmLabel !== 'string'
    ) {
      logger.warn(
        'FileManager.confirmDestructive',
        'Rejected malformed confirm-destructive request',
      );
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
   * @param decode How to decode its bytes; the default tells the encoding from them.
   * @returns Returns the file info.
   */
  private async readFileInfo(filePath: string, decode: TextDecodeOptions = {}): Promise<FileInfo> {
    // The byte-order mark is stripped from the content but recorded, so it is written back and the
    // editor never shows it as an invisible character.
    const decoded: DecodedText = decodeText(await fs.readFile(filePath), decode);
    logger.debug(
      'FileManager.readFileInfo',
      `Read ${filePath} (${decoded.encoding}, hasBom=${decoded.bom})`,
    );
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath),
      content: decoded.text,
      encoding: decoded.encoding,
      hasBom: decoded.bom,
    };
  }
}
