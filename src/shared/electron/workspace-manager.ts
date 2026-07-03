import {
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  OpenDialogReturnValue,
} from 'electron';
import * as fs from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import * as path from 'node:path';
import { ProjectItems, ProjectModel } from '@shared/project-system';
import { FileInfo } from '@shared/api/file-channels';
import { ProjectChannel } from '@shared/api/project-channels';
import {
  DirectoryEntry,
  DirectoryListing,
  FileOperationResult,
  OpenSelection,
  WorkspaceChannel,
} from '@shared/api/workspace-channels';
import { projectSystems } from './project-system/default-project-systems';
import { ProjectSystem } from './project-system/project-system';
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
 * Specifies how many leading bytes of a file are scanned for a NUL byte when sniffing for binary
 * content.
 */
const BINARY_SNIFF_LENGTH: number = 8000;

/**
 * Specifies the byte value (NUL) whose presence marks a file as binary.
 */
const NUL_BYTE: number = 0;

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
    ipcMain.handle(WorkspaceChannel.Open, (): Promise<OpenSelection | null> => this.open());
    ipcMain.handle(
      WorkspaceChannel.OpenFile,
      (_event: IpcMainInvokeEvent, filePath: unknown): Promise<OpenSelection | null> =>
        this.openFile(filePath),
    );
    ipcMain.handle(
      WorkspaceChannel.OpenFolder,
      (): Promise<DirectoryListing | null> => this.openFolder(),
    );
    ipcMain.handle(
      WorkspaceChannel.CloseFolder,
      (_event: IpcMainInvokeEvent, root: unknown): void => {
        if (typeof root === 'string' && root.length > 0) {
          this.workspace.removeRoot(root);
        }
      },
    );
    ipcMain.handle(
      WorkspaceChannel.ReadDirectory,
      (_event: IpcMainInvokeEvent, directoryPath: unknown): Promise<DirectoryListing | null> =>
        this.readDirectory(directoryPath),
    );
    ipcMain.handle(
      WorkspaceChannel.CreateFile,
      (
        _event: IpcMainInvokeEvent,
        directoryPath: unknown,
        name: unknown,
      ): Promise<FileOperationResult> => this.create(directoryPath, name, 'file'),
    );
    ipcMain.handle(
      WorkspaceChannel.CreateFolder,
      (
        _event: IpcMainInvokeEvent,
        directoryPath: unknown,
        name: unknown,
      ): Promise<FileOperationResult> => this.create(directoryPath, name, 'directory'),
    );
    ipcMain.handle(
      WorkspaceChannel.Rename,
      (
        _event: IpcMainInvokeEvent,
        targetPath: unknown,
        newName: unknown,
      ): Promise<FileOperationResult> => this.rename(targetPath, newName),
    );
    ipcMain.handle(
      WorkspaceChannel.Delete,
      (_event: IpcMainInvokeEvent, targetPath: unknown): Promise<FileOperationResult> =>
        this.delete(targetPath),
    );
    ipcMain.handle(
      ProjectChannel.ModelLoad,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<ProjectModel | null> =>
        this.loadProjectModel(root),
    );
    ipcMain.handle(
      ProjectChannel.ItemsLoad,
      (_event: IpcMainInvokeEvent, projectPath: unknown): Promise<ProjectItems | null> =>
        this.loadProjectItems(projectPath),
    );
  }

  /**
   * Loads the logical project model for an open workspace root, resolving the project system that
   * applies to it. Confined to open roots so the renderer cannot drive a filesystem scan of arbitrary
   * locations.
   * @param root The candidate workspace root.
   * @returns Returns the model, or null when the root is not open or no project system applies.
   */
  private async loadProjectModel(root: unknown): Promise<ProjectModel | null> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return null;
    }
    const system: ProjectSystem | null = await projectSystems.match(root);
    return system === null ? null : system.load(root);
  }

  /**
   * Loads a single project's logical contents (its files), confined to projects within an open
   * workspace so the renderer cannot drive evaluation of arbitrary files.
   * @param projectPath The candidate project-file path.
   * @returns Returns the contents, or null when the path is outside the workspace or has no contents.
   */
  private async loadProjectItems(projectPath: unknown): Promise<ProjectItems | null> {
    if (typeof projectPath !== 'string' || !this.workspace.isWithin(projectPath)) {
      return null;
    }
    const system: ProjectSystem | undefined = projectSystems.get('dotnet');
    return (await system?.loadProjectItems?.(projectPath)) ?? null;
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
    this.workspace.addRoot(root);
    try {
      return await this.readListing(root);
    } catch {
      this.workspace.removeRoot(root);
      return null;
    }
  }

  /**
   * Shows a combined open dialog allowing either a file or a folder to be chosen. A folder becomes
   * the workspace root; a file is returned as text content, or as a binary marker when it is not
   * decodable text.
   * @returns Returns the selection, or null when the dialog was cancelled or unreadable.
   */
  private async open(): Promise<OpenSelection | null> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return null;
    }
    const result: OpenDialogReturnValue = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const selectedPath: string = path.resolve(result.filePaths[0]);
    try {
      const stats: Stats = await fs.stat(selectedPath);
      if (stats.isDirectory()) {
        this.workspace.addRoot(selectedPath);
        return { kind: 'directory', directory: await this.readListing(selectedPath) };
      }
      return await this.readFileSelection(selectedPath);
    } catch {
      return null;
    }
  }

  /**
   * Reads a single file within the workspace for opening in an editor.
   * @param filePath The absolute path of the file to read.
   * @returns Returns the file selection (text or binary), or null when invalid or outside the workspace.
   */
  private async openFile(filePath: unknown): Promise<OpenSelection | null> {
    if (!this.workspace.isWithin(filePath)) {
      return null;
    }
    try {
      return await this.readFileSelection(path.resolve(filePath as string));
    } catch {
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
    if (this.workspace.isRoot(resolved)) {
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
    if (this.workspace.isRoot(resolved)) {
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
   * Reads a file and classifies it as text or binary. Binary files are recognised but not decoded,
   * so the renderer can decline to open them in a text editor.
   * @param filePath The absolute path of the file to read.
   * @returns Returns a text-file or binary selection.
   */
  private async readFileSelection(filePath: string): Promise<OpenSelection> {
    const buffer: Buffer = await fs.readFile(filePath);
    if (this.isBinary(buffer)) {
      return { kind: 'binary', path: filePath };
    }
    return { kind: 'file', file: this.readFileInfo(filePath, buffer.toString('utf-8')) };
  }

  /**
   * Builds a {@link FileInfo} from a file's path and decoded content.
   * @param filePath The absolute path of the file.
   * @param content The decoded textual content.
   * @returns Returns the file info.
   */
  private readFileInfo(filePath: string, content: string): FileInfo {
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath),
      content,
    };
  }

  /**
   * Determines whether a buffer looks like binary content by scanning its leading bytes for a NUL,
   * the same heuristic editors use to avoid opening binaries as text.
   * @param buffer The file content to inspect.
   * @returns Returns true when a NUL byte is found within the sniffed range.
   */
  private isBinary(buffer: Buffer): boolean {
    const length: number = Math.min(buffer.length, BINARY_SNIFF_LENGTH);
    for (let index: number = 0; index < length; index += 1) {
      if (buffer[index] === NUL_BYTE) {
        return true;
      }
    }
    return false;
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
