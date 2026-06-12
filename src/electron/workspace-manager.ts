import {
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  OpenDialogReturnValue,
} from 'electron';
import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { IpcChannel } from '../shared/ipc-channels';
import { DirectoryEntry, DirectoryListing, FileOperationResult } from '../shared/studio-api';
import { WorkspaceContext } from './workspace-context';

/**
 * Specifies the sort order placing directories before files.
 */
const DIRECTORY_ORDER: number = 0;

/**
 * Specifies the sort order placing files after directories.
 */
const FILE_ORDER: number = 1;

/**
 * Handles workspace (open folder) and directory IPC on behalf of the renderer: opening a folder as
 * the workspace, reading directory listings, and creating, renaming, and deleting entries. Every
 * path-taking operation is confined to the open workspace root through the shared
 * {@link WorkspaceContext}, so the renderer cannot read or write arbitrary locations.
 */
export class WorkspaceManager {
  /**
   * Holds the function used to resolve the window that owns the dialogs.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the shared workspace context tracking the open root.
   */
  private readonly workspace: WorkspaceContext;

  /**
   * Initializes a new instance of the {@link WorkspaceManager} class.
   * @param windowGetter A function that returns the window the dialogs are parented to.
   * @param workspace The shared workspace context to update when a folder is opened or closed.
   */
  public constructor(windowGetter: () => BrowserWindow | null, workspace: WorkspaceContext) {
    this.windowGetter = windowGetter;
    this.workspace = workspace;
  }

  /**
   * Registers the workspace IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      IpcChannel.WorkspaceOpenFolder,
      (): Promise<DirectoryListing | null> => this.openFolder(),
    );
    ipcMain.handle(IpcChannel.WorkspaceCloseFolder, (): void => this.workspace.setRoot(null));
    ipcMain.handle(
      IpcChannel.WorkspaceReadDirectory,
      (_event: IpcMainInvokeEvent, directoryPath: unknown): Promise<DirectoryListing | null> =>
        this.readDirectory(directoryPath),
    );
    ipcMain.handle(
      IpcChannel.WorkspaceCreateFile,
      (
        _event: IpcMainInvokeEvent,
        directoryPath: unknown,
        name: unknown,
      ): Promise<FileOperationResult> => this.create(directoryPath, name, 'file'),
    );
    ipcMain.handle(
      IpcChannel.WorkspaceCreateFolder,
      (
        _event: IpcMainInvokeEvent,
        directoryPath: unknown,
        name: unknown,
      ): Promise<FileOperationResult> => this.create(directoryPath, name, 'directory'),
    );
    ipcMain.handle(
      IpcChannel.WorkspaceRename,
      (
        _event: IpcMainInvokeEvent,
        targetPath: unknown,
        newName: unknown,
      ): Promise<FileOperationResult> => this.rename(targetPath, newName),
    );
    ipcMain.handle(
      IpcChannel.WorkspaceDelete,
      (_event: IpcMainInvokeEvent, targetPath: unknown): Promise<FileOperationResult> =>
        this.delete(targetPath),
    );
  }

  /**
   * Shows an open-folder dialog and, when a folder is chosen, sets it as the workspace root.
   * @returns Returns the root directory listing, or null when the dialog was cancelled or unreadable.
   */
  private async openFolder(): Promise<DirectoryListing | null> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return null;
    }
    const result: OpenDialogReturnValue = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const root: string = path.resolve(result.filePaths[0]);
    this.workspace.setRoot(root);
    try {
      return await this.readListing(root);
    } catch {
      this.workspace.setRoot(null);
      return null;
    }
  }

  /**
   * Reads the immediate children of a directory within the workspace.
   * @param directoryPath The directory to read.
   * @returns Returns the listing, or null when the path is invalid or outside the workspace.
   */
  private async readDirectory(directoryPath: unknown): Promise<DirectoryListing | null> {
    if (!this.workspace.isWithin(directoryPath)) {
      return null;
    }
    try {
      return await this.readListing(path.resolve(directoryPath as string));
    } catch {
      return null;
    }
  }

  /**
   * Creates an empty file or a folder inside a workspace directory.
   * @param directoryPath The parent directory.
   * @param name The new entry's name.
   * @param type Whether to create a file or a directory.
   * @returns Returns the result describing success or failure.
   */
  private async create(
    directoryPath: unknown,
    name: unknown,
    type: 'file' | 'directory',
  ): Promise<FileOperationResult> {
    if (!this.workspace.isWithin(directoryPath)) {
      return { success: false, error: 'Target is outside the workspace' };
    }
    if (!this.isValidName(name)) {
      return { success: false, error: 'Invalid name' };
    }
    const target: string = path.join(path.resolve(directoryPath as string), name as string);
    try {
      if (type === 'directory') {
        await fs.mkdir(target);
      } else {
        await fs.writeFile(target, '', { flag: 'wx' });
      }
      return { success: true, path: target };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Renames a file or folder within the workspace, keeping it in the same directory.
   * @param targetPath The absolute path of the entry to rename.
   * @param newName The new name (a single path segment).
   * @returns Returns the result describing success and the new path.
   */
  private async rename(targetPath: unknown, newName: unknown): Promise<FileOperationResult> {
    if (!this.workspace.isWithin(targetPath)) {
      return { success: false, error: 'Target is outside the workspace' };
    }
    if (!this.isValidName(newName)) {
      return { success: false, error: 'Invalid name' };
    }
    const resolved: string = path.resolve(targetPath as string);
    if (resolved === this.workspace.getRoot()) {
      return { success: false, error: 'Cannot rename the workspace root' };
    }
    const destination: string = path.join(path.dirname(resolved), newName as string);
    try {
      await fs.rename(resolved, destination);
      return { success: true, path: destination };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Deletes a file or folder within the workspace. Folders are removed recursively.
   * @param targetPath The absolute path of the entry to delete.
   * @returns Returns the result describing success or failure.
   */
  private async delete(targetPath: unknown): Promise<FileOperationResult> {
    if (!this.workspace.isWithin(targetPath)) {
      return { success: false, error: 'Target is outside the workspace' };
    }
    const resolved: string = path.resolve(targetPath as string);
    if (resolved === this.workspace.getRoot()) {
      return { success: false, error: 'Cannot delete the workspace root' };
    }
    try {
      await fs.rm(resolved, { recursive: true, force: false });
      return { success: true, path: resolved };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Reads a directory's immediate children, ordered directories-first then by name
   * (case-insensitive).
   * @param directoryPath The absolute directory path.
   * @returns Returns the directory listing.
   */
  private async readListing(directoryPath: string): Promise<DirectoryListing> {
    const dirents: Dirent[] = await fs.readdir(directoryPath, { withFileTypes: true });
    const entries: DirectoryEntry[] = dirents
      .map(
        (dirent: Dirent): DirectoryEntry => ({
          name: dirent.name,
          path: path.join(directoryPath, dirent.name),
          type: dirent.isDirectory() ? 'directory' : 'file',
        }),
      )
      .sort((a: DirectoryEntry, b: DirectoryEntry): number => {
        const orderA: number = a.type === 'directory' ? DIRECTORY_ORDER : FILE_ORDER;
        const orderB: number = b.type === 'directory' ? DIRECTORY_ORDER : FILE_ORDER;
        return orderA - orderB || a.name.localeCompare(b.name);
      });
    return { path: directoryPath, name: path.basename(directoryPath), entries };
  }

  /**
   * Determines whether a proposed entry name is a single, safe path segment.
   * @param name The name to validate.
   * @returns Returns true when the name is non-empty and contains no path separators or traversal.
   */
  private isValidName(name: unknown): boolean {
    return (
      typeof name === 'string' &&
      name.length > 0 &&
      name === path.basename(name) &&
      name !== '.' &&
      name !== '..'
    );
  }
}
