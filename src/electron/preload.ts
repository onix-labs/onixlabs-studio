import { contextBridge, IpcRendererEvent, ipcRenderer } from 'electron';
import { IpcChannel } from '../shared/ipc-channels';
import type {
  DirectoryListing,
  FileInfo,
  FileOperationResult,
  FileWriteResult,
  OpenSelection,
  SaveDialogChoice,
  StudioApi,
  TempFileResult,
  TerminalCreateOptions,
  TerminalCreateResult,
} from '../shared/studio-api';

/**
 * Specifies the concrete API exposed to the renderer under `window.studio`.
 */
const studioApi: StudioApi = {
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron,
  },
  platform: process.platform,
  windowControls: {
    minimize: (): void => ipcRenderer.send(IpcChannel.WindowMinimize),
    toggleMaximize: (): void => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
    close: (): void => ipcRenderer.send(IpcChannel.WindowClose),
    setMovable: (movable: boolean): void => ipcRenderer.send(IpcChannel.WindowSetMovable, movable),
  },
  terminal: {
    create: (options: TerminalCreateOptions): Promise<TerminalCreateResult> =>
      ipcRenderer.invoke(IpcChannel.TerminalCreate, options) as Promise<TerminalCreateResult>,
    write: (id: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.TerminalWrite, id, data) as Promise<boolean>,
    resize: (id: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.TerminalResize, id, cols, rows) as Promise<boolean>,
    dispose: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.TerminalDispose, id) as Promise<boolean>,
    getCwd: (id: string): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.TerminalGetCwd, id) as Promise<string | null>,
    onData: (listener: (id: string, data: string) => void): (() => void) => {
      const handler: (event: IpcRendererEvent, id: string, data: string) => void = (
        _event: IpcRendererEvent,
        id: string,
        data: string,
      ): void => listener(id, data);
      ipcRenderer.on(IpcChannel.TerminalData, handler);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.TerminalData, handler);
      };
    },
    onExit: (
      listener: (id: string, exitCode: number, signal: number | null) => void,
    ): (() => void) => {
      const handler: (
        event: IpcRendererEvent,
        id: string,
        exitCode: number,
        signal: number | null,
      ) => void = (
        _event: IpcRendererEvent,
        id: string,
        exitCode: number,
        signal: number | null,
      ): void => listener(id, exitCode, signal);
      ipcRenderer.on(IpcChannel.TerminalExit, handler);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.TerminalExit, handler);
      };
    },
  },
  shell: {
    openPath: (path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.ShellOpenPath, path) as Promise<void>,
  },
  file: {
    read: (path: string): Promise<FileInfo | null> =>
      ipcRenderer.invoke(IpcChannel.FileRead, path) as Promise<FileInfo | null>,
    write: (path: string, content: string): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IpcChannel.FileWrite, path, content) as Promise<FileWriteResult>,
    openDialog: (): Promise<FileInfo | null> =>
      ipcRenderer.invoke(IpcChannel.DialogOpenFile) as Promise<FileInfo | null>,
    saveDialog: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.DialogSaveFile, defaultPath) as Promise<string | null>,
    confirmSave: (fileName: string): Promise<SaveDialogChoice> =>
      ipcRenderer.invoke(IpcChannel.DialogConfirmSave, fileName) as Promise<SaveDialogChoice>,
  },
  run: {
    writeTempFile: (key: string, extension: string, content: string): Promise<TempFileResult> =>
      ipcRenderer.invoke(
        IpcChannel.RunWriteTempFile,
        key,
        extension,
        content,
      ) as Promise<TempFileResult>,
  },
  workspace: {
    open: (): Promise<OpenSelection | null> =>
      ipcRenderer.invoke(IpcChannel.WorkspaceOpen) as Promise<OpenSelection | null>,
    openFile: (path: string): Promise<OpenSelection | null> =>
      ipcRenderer.invoke(IpcChannel.WorkspaceOpenFile, path) as Promise<OpenSelection | null>,
    openFolder: (): Promise<DirectoryListing | null> =>
      ipcRenderer.invoke(IpcChannel.WorkspaceOpenFolder) as Promise<DirectoryListing | null>,
    closeFolder: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.WorkspaceCloseFolder) as Promise<void>,
    readDirectory: (path: string): Promise<DirectoryListing | null> =>
      ipcRenderer.invoke(
        IpcChannel.WorkspaceReadDirectory,
        path,
      ) as Promise<DirectoryListing | null>,
    createFile: (directoryPath: string, name: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke(
        IpcChannel.WorkspaceCreateFile,
        directoryPath,
        name,
      ) as Promise<FileOperationResult>,
    createFolder: (directoryPath: string, name: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke(
        IpcChannel.WorkspaceCreateFolder,
        directoryPath,
        name,
      ) as Promise<FileOperationResult>,
    rename: (targetPath: string, newName: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke(
        IpcChannel.WorkspaceRename,
        targetPath,
        newName,
      ) as Promise<FileOperationResult>,
    delete: (targetPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke(IpcChannel.WorkspaceDelete, targetPath) as Promise<FileOperationResult>,
  },
};

contextBridge.exposeInMainWorld('studio', studioApi);
