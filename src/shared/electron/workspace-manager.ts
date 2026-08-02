import {
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  OpenDialogReturnValue,
  WebContents,
} from 'electron';
import { showOpenDialog } from './dialog-parent';
import * as fs from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import * as path from 'node:path';
import { ProjectItems, ProjectModel } from '@shared/api/project-system';
import { FileInfo } from '@shared/api/file-channels';
import { ProjectChannel } from '@shared/api/project-channels';
import {
  BinaryChunk,
  BinaryPatch,
  BinarySpan,
  DirectoryEntry,
  DirectoryListing,
  FileOperationResult,
  OpenSelection,
  WorkspaceChannel,
} from '@shared/api/workspace-channels';
import type { FileHandle } from 'node:fs/promises';
import { projectSystems } from './project-system/default-project-systems';
import { ProjectSystem } from './project-system/project-system';
import { TrustedPaths } from './trusted-paths';
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
 * The largest file opened as editable text (50 MB). Bigger files — huge logs, generated SQL, data
 * dumps — open in the binary/hex editor, which windows its reads, instead of being decoded whole
 * into one IPC payload and a Monaco model.
 */
const MAX_TEXT_FILE_BYTES: number = 50 * 1024 * 1024;

/**
 * Specifies the byte value (NUL) whose presence marks a file as binary.
 */
const NUL_BYTE: number = 0;

/**
 * Specifies the largest byte window a single {@link WorkspaceChannel.ReadBytes} request may return,
 * bounding the IPC payload however large a viewport the renderer asks for.
 */
const MAX_READ_BYTES: number = 1024 * 1024;

/**
 * Handles workspace (open folder) and directory IPC on behalf of the renderer: opening a folder as
 * the workspace, reading directory listings, and creating, renaming, and deleting entries. Every
 * path-taking operation is confined to the open workspace root through the shared
 * {@link WorkspaceContext}, so the renderer cannot read or write arbitrary locations.
 */
export class WorkspaceManager {
  /**
   * Holds the function used to resolve the window dialogs fall back to when the requesting window
   * is gone.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the shared workspace context tracking the open root.
   */
  private readonly workspace: WorkspaceContext;

  /**
   * Holds the store of paths the user has opened through a dialog, used to authorise re-opens.
   */
  private readonly trusted: TrustedPaths;

  /**
   * Initializes a new instance of the {@link WorkspaceManager} class.
   * @param windowGetter A function that returns the window dialogs are parented to when the
   * requesting window is gone.
   * @param workspace The shared workspace context to update when a folder is opened or closed.
   * @param trusted The store recording paths the user has opened, gating path-based re-opens.
   */
  public constructor(
    windowGetter: () => BrowserWindow | null,
    workspace: WorkspaceContext,
    trusted: TrustedPaths,
  ) {
    this.windowGetter = windowGetter;
    this.workspace = workspace;
    this.trusted = trusted;
  }

  /**
   * Registers the workspace IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      WorkspaceChannel.Open,
      (event: IpcMainInvokeEvent): Promise<OpenSelection | null> => this.open(event.sender),
    );
    ipcMain.handle(
      WorkspaceChannel.OpenFile,
      (_event: IpcMainInvokeEvent, filePath: unknown): Promise<OpenSelection | null> =>
        this.openFile(filePath),
    );
    ipcMain.handle(
      WorkspaceChannel.ReadBytes,
      (
        _event: IpcMainInvokeEvent,
        filePath: unknown,
        offset: unknown,
        length: unknown,
      ): Promise<BinaryChunk | null> => this.readBytes(filePath, offset, length),
    );
    ipcMain.handle(
      WorkspaceChannel.WriteBytes,
      (_event: IpcMainInvokeEvent, filePath: unknown, patches: unknown): Promise<boolean> =>
        this.writeBytes(filePath, patches),
    );
    ipcMain.handle(
      WorkspaceChannel.WritePieces,
      (
        _event: IpcMainInvokeEvent,
        filePath: unknown,
        spans: unknown,
        added: unknown,
      ): Promise<boolean> => this.writePieces(filePath, spans, added),
    );
    ipcMain.handle(
      WorkspaceChannel.OpenFolder,
      (event: IpcMainInvokeEvent): Promise<DirectoryListing | null> =>
        this.openFolder(event.sender),
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
      WorkspaceChannel.ReopenFolder,
      (_event: IpcMainInvokeEvent, folderPath: unknown): Promise<DirectoryListing | null> =>
        this.reopenFolder(folderPath),
    );
    ipcMain.handle(
      WorkspaceChannel.ReopenFile,
      (_event: IpcMainInvokeEvent, filePath: unknown): Promise<OpenSelection | null> =>
        this.reopenFile(filePath),
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
    if (system === null) {
      return null;
    }
    return system.load(root);
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
    const system: ProjectSystem | null = projectSystems.matchProject(projectPath);
    return (await system?.loadProjectItems?.(projectPath)) ?? null;
  }

  /**
   * Shows an open-folder dialog and, when a folder is chosen, sets it as the workspace root.
   * @param sender The web contents that requested the dialog.
   * @returns Returns the root directory listing, or null when the dialog was cancelled or unreadable.
   */
  private async openFolder(sender: WebContents): Promise<DirectoryListing | null> {
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const root: string = path.resolve(result.filePaths[0]);
    this.workspace.addRoot(root);
    this.trusted.remember(root);
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
   * @param sender The web contents that requested the dialog.
   * @returns Returns the selection, or null when the dialog was cancelled or unreadable.
   */
  private async open(sender: WebContents): Promise<OpenSelection | null> {
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
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
        this.trusted.remember(selectedPath);
        return { kind: 'directory', directory: await this.readListing(selectedPath) };
      }
      this.trusted.remember(selectedPath);
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
      const resolved: string = path.resolve(filePath as string);
      const selection: OpenSelection = await this.readFileSelection(resolved);
      // Remember the file so it can be re-opened from the welcome screen once its workspace is closed.
      this.trusted.remember(resolved);
      return selection;
    } catch {
      return null;
    }
  }

  /**
   * Reads a window of raw bytes from a file for the binary/hex editor. Honoured for files within an
   * open workspace or paths the user has opened before, so the renderer cannot read arbitrary files.
   * The window is clamped to the file and bounded by {@link MAX_READ_BYTES}, and the total file size is
   * returned so the renderer can size its virtual scroll without loading the whole file.
   * @param filePath The absolute path of the file to read.
   * @param offset The absolute byte offset to start reading from.
   * @param length The number of bytes to read.
   * @returns Returns the byte window and total size, or null when invalid, untrusted, or unreadable.
   */
  private async readBytes(
    filePath: unknown,
    offset: unknown,
    length: unknown,
  ): Promise<BinaryChunk | null> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return null;
    }
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      return null;
    }
    if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
      return null;
    }
    if (!this.trusted.has(filePath) && !this.workspace.isWithin(filePath)) {
      return null;
    }
    const resolved: string = path.resolve(filePath);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(resolved, 'r');
      const size: number = (await handle.stat()).size;
      const start: number = Math.min(offset, size);
      const toRead: number = Math.min(length, MAX_READ_BYTES, size - start);
      const buffer: Buffer = Buffer.alloc(Math.max(0, toRead));
      if (buffer.length > 0) {
        await handle.read(buffer, 0, buffer.length, start);
      }
      return { size, offset: start, bytes: new Uint8Array(buffer) };
    } catch {
      return null;
    } finally {
      await handle?.close();
    }
  }

  /**
   * Writes in-place byte patches to a file, for saving binary/hex edits. Each patch overwrites a run
   * of bytes at a fixed offset within the file's existing length; the file is never grown or shrunk.
   * Honoured only for trusted paths or files within an open workspace.
   * @param filePath The absolute path of the file to write.
   * @param patches The byte runs to overwrite, each with an offset and byte values.
   * @returns Returns true when every patch was written, or false when invalid, untrusted, or on error.
   */
  private async writeBytes(filePath: unknown, patches: unknown): Promise<boolean> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return false;
    }
    if (!this.trusted.has(filePath) && !this.workspace.isWithin(filePath)) {
      return false;
    }
    if (!Array.isArray(patches)) {
      return false;
    }
    const runs: BinaryPatch[] = patches as BinaryPatch[];
    const resolved: string = path.resolve(filePath);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(resolved, 'r+');
      const size: number = (await handle.stat()).size;
      for (const run of runs) {
        if (
          typeof run.offset !== 'number' ||
          !Number.isInteger(run.offset) ||
          run.offset < 0 ||
          !Array.isArray(run.bytes) ||
          run.offset + run.bytes.length > size
        ) {
          return false;
        }
        if (run.bytes.length > 0) {
          await handle.write(Buffer.from(run.bytes), 0, run.bytes.length, run.offset);
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      await handle?.close();
    }
  }

  /**
   * Rewrites a file from a list of spans, for saving binary/hex edits that insert or delete bytes. It
   * streams each span — original ranges copied from the current file, added ranges from the supplied
   * buffer — to a temporary file, then atomically renames it over the original, so memory stays bounded
   * however large the file. Honoured only for trusted paths or files within an open workspace.
   * @param filePath The absolute path of the file to rewrite.
   * @param spans The spans that make up the new file content, in order.
   * @param added The added buffer the `added` spans index into.
   * @returns Returns true when the rewrite succeeded, or false when invalid, untrusted, or on error.
   */
  private async writePieces(filePath: unknown, spans: unknown, added: unknown): Promise<boolean> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return false;
    }
    if (!this.trusted.has(filePath) && !this.workspace.isWithin(filePath)) {
      return false;
    }
    if (!Array.isArray(spans) || !(added instanceof Uint8Array)) {
      return false;
    }
    const runs: BinarySpan[] = spans as BinarySpan[];
    const addedBuffer: Buffer = Buffer.from(added);
    const resolved: string = path.resolve(filePath);
    const tempPath: string = `${resolved}.onix-save`;
    let source: FileHandle | undefined;
    let temp: FileHandle | undefined;
    try {
      source = await fs.open(resolved, 'r');
      temp = await fs.open(tempPath, 'w');
      const chunk: Buffer = Buffer.alloc(64 * 1024);
      for (const run of runs) {
        if (
          (run.source !== 'original' && run.source !== 'added') ||
          typeof run.start !== 'number' ||
          !Number.isInteger(run.start) ||
          run.start < 0 ||
          typeof run.length !== 'number' ||
          !Number.isInteger(run.length) ||
          run.length < 0
        ) {
          return false;
        }
        if (run.source === 'added') {
          if (run.start + run.length > addedBuffer.length) {
            return false;
          }
          await temp.write(addedBuffer, run.start, run.length);
        } else {
          let position: number = run.start;
          let remaining: number = run.length;
          while (remaining > 0) {
            const toRead: number = Math.min(remaining, chunk.length);
            const { bytesRead }: { bytesRead: number } = await source.read(
              chunk,
              0,
              toRead,
              position,
            );
            if (bytesRead <= 0) {
              return false;
            }
            await temp.write(chunk, 0, bytesRead);
            position += bytesRead;
            remaining -= bytesRead;
          }
        }
      }
      await temp.close();
      temp = undefined;
      await source.close();
      source = undefined;
      await fs.rename(tempPath, resolved);
      return true;
    } catch {
      return false;
    } finally {
      await temp?.close();
      await source?.close();
      await fs.rm(tempPath, { force: true }).catch((): void => undefined);
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
   * Re-opens a previously user-opened folder by path as a workspace root. Honoured only for paths the
   * user has opened through a dialog before, so the renderer cannot register an arbitrary root.
   * @param folderPath The absolute folder path to re-open.
   * @returns Returns the root directory listing, or null when untrusted or unreadable.
   */
  private async reopenFolder(folderPath: unknown): Promise<DirectoryListing | null> {
    if (!this.trusted.has(folderPath)) {
      return null;
    }
    const resolved: string = path.resolve(folderPath as string);
    this.workspace.addRoot(resolved);
    try {
      return await this.readListing(resolved);
    } catch {
      this.workspace.removeRoot(resolved);
      return null;
    }
  }

  /**
   * Re-opens a previously user-opened file by path. Honoured for paths the user has opened through a
   * dialog before, or files already within an open workspace, so the renderer cannot read arbitrary
   * files.
   * @param filePath The absolute file path to re-open.
   * @returns Returns the file selection (text or binary), or null when untrusted or unreadable.
   */
  private async reopenFile(filePath: unknown): Promise<OpenSelection | null> {
    if (!this.trusted.has(filePath) && !this.workspace.isWithin(filePath)) {
      return null;
    }
    try {
      return await this.readFileSelection(path.resolve(filePath as string));
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
    // A text file past the cap opens in the binary/hex editor, which reads it in windows on demand:
    // decoding a multi-hundred-megabyte log into one string, shipping it over IPC, and mounting it
    // in Monaco would stall the whole application.
    const stats: Stats = await fs.stat(filePath);
    if (stats.size > MAX_TEXT_FILE_BYTES || (await this.isBinaryFile(filePath))) {
      return { kind: 'binary', path: filePath };
    }
    const content: string = await fs.readFile(filePath, 'utf-8');
    return { kind: 'file', file: this.readFileInfo(filePath, content) };
  }

  /**
   * Determines whether a file is binary by sniffing only its leading bytes, so a large binary is
   * classified without reading it whole (the binary/hex editor then reads it in windows on demand).
   * @param filePath The absolute path of the file to sniff.
   * @returns Returns true when a NUL byte is found within the sniffed header.
   */
  private async isBinaryFile(filePath: string): Promise<boolean> {
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(filePath, 'r');
      const header: Buffer = Buffer.alloc(BINARY_SNIFF_LENGTH);
      const { bytesRead }: { bytesRead: number } = await handle.read(
        header,
        0,
        BINARY_SNIFF_LENGTH,
        0,
      );
      return this.isBinary(header.subarray(0, bytesRead));
    } finally {
      await handle?.close();
    }
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
