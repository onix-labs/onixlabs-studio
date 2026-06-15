import { contextBridge, IpcRendererEvent, ipcRenderer } from 'electron';
import type {
  AiAuthStatus,
  AiBridgeReply,
  AiBridgeRequest,
  AiEvent,
  AiPermissionReply,
  AiProviderInfo,
  AiRunRequest,
  AiVerifyResult,
} from '../shared/ai-types';
import { IpcChannel } from '../shared/ipc-channels';
import type {
  LspExit,
  LspMessage,
  LspSettings,
  LspStartRequest,
  LspStartResult,
} from '../shared/lsp-types';
import type { ImageSourcePolicy } from '../shared/security-types';
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
  app: {
    onRequestClose: (listener: () => void): (() => void) => {
      const handler: (event: IpcRendererEvent) => void = (): void => listener();
      ipcRenderer.on(IpcChannel.AppRequestClose, handler);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.AppRequestClose, handler);
      };
    },
    respondClose: (proceed: boolean): void => ipcRenderer.send(IpcChannel.AppConfirmClose, proceed),
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
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.ShellOpenExternal, url) as Promise<void>,
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
    watch: (path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.FileWatch, path) as Promise<void>,
    unwatch: (path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.FileUnwatch, path) as Promise<void>,
    onChanged: (listener: (path: string) => void): (() => void) => {
      const handler: (event: IpcRendererEvent, path: string) => void = (
        _event: IpcRendererEvent,
        path: string,
      ): void => listener(path);
      ipcRenderer.on(IpcChannel.FileChanged, handler);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.FileChanged, handler);
      };
    },
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
    closeFolder: (root: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.WorkspaceCloseFolder, root) as Promise<void>,
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
  ai: {
    getAuthStatus: (): Promise<AiAuthStatus> =>
      ipcRenderer.invoke(IpcChannel.AiAuthStatus) as Promise<AiAuthStatus>,
    setApiKey: (key: string): Promise<AiAuthStatus> =>
      ipcRenderer.invoke(IpcChannel.AiSetApiKey, key) as Promise<AiAuthStatus>,
    clearApiKey: (): Promise<AiAuthStatus> =>
      ipcRenderer.invoke(IpcChannel.AiClearApiKey) as Promise<AiAuthStatus>,
    verifyAuthentication: (): Promise<AiVerifyResult> =>
      ipcRenderer.invoke(IpcChannel.AiVerify) as Promise<AiVerifyResult>,
    listProviders: (): Promise<readonly AiProviderInfo[]> =>
      ipcRenderer.invoke(IpcChannel.AiListProviders) as Promise<readonly AiProviderInfo[]>,
    run: (request: AiRunRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.AiRun, request) as Promise<void>,
    abort: (requestId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.AiAbort, requestId) as Promise<void>,
    onEvent: (listener: (event: AiEvent) => void): (() => void) => {
      const handler: (event: IpcRendererEvent, payload: AiEvent) => void = (
        _event: IpcRendererEvent,
        payload: AiEvent,
      ): void => listener(payload);
      ipcRenderer.on(IpcChannel.AiEvent, handler);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.AiEvent, handler);
      };
    },
    onBridgeRequest: (handler: (request: AiBridgeRequest) => void): (() => void) => {
      const wrapped: (event: IpcRendererEvent, payload: AiBridgeRequest) => void = (
        _event: IpcRendererEvent,
        payload: AiBridgeRequest,
      ): void => handler(payload);
      ipcRenderer.on(IpcChannel.AiBridgeRequest, wrapped);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.AiBridgeRequest, wrapped);
      };
    },
    respondBridge: (reply: AiBridgeReply): void => {
      ipcRenderer.send(IpcChannel.AiBridgeReply, reply);
    },
    respondPermission: (reply: AiPermissionReply): void => {
      ipcRenderer.send(IpcChannel.AiPermissionReply, reply);
    },
  },
  security: {
    getImagePolicy: (): Promise<ImageSourcePolicy> =>
      ipcRenderer.invoke(IpcChannel.SecurityGetImagePolicy) as Promise<ImageSourcePolicy>,
    setImagePolicy: (policy: ImageSourcePolicy): Promise<ImageSourcePolicy> =>
      ipcRenderer.invoke(IpcChannel.SecuritySetImagePolicy, policy) as Promise<ImageSourcePolicy>,
  },
  lsp: {
    start: (request: LspStartRequest): Promise<LspStartResult> =>
      ipcRenderer.invoke(IpcChannel.LspStart, request) as Promise<LspStartResult>,
    stop: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.LspStop, sessionId) as Promise<void>,
    notify: (sessionId: string, method: string, params?: unknown): void =>
      ipcRenderer.send(IpcChannel.LspNotify, sessionId, method, params),
    request: (sessionId: string, method: string, params?: unknown): Promise<unknown> =>
      ipcRenderer.invoke(IpcChannel.LspRequest, sessionId, method, params),
    onNotification: (listener: (message: LspMessage) => void): (() => void) => {
      const handler: (event: IpcRendererEvent, message: LspMessage) => void = (
        _event: IpcRendererEvent,
        message: LspMessage,
      ): void => listener(message);
      ipcRenderer.on(IpcChannel.LspNotification, handler);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.LspNotification, handler);
      };
    },
    onExit: (listener: (exit: LspExit) => void): (() => void) => {
      const handler: (event: IpcRendererEvent, exit: LspExit) => void = (
        _event: IpcRendererEvent,
        exit: LspExit,
      ): void => listener(exit);
      ipcRenderer.on(IpcChannel.LspServerExit, handler);
      return (): void => {
        ipcRenderer.removeListener(IpcChannel.LspServerExit, handler);
      };
    },
    getSettings: (): Promise<LspSettings> =>
      ipcRenderer.invoke(IpcChannel.LspGetSettings) as Promise<LspSettings>,
    setSettings: (settings: LspSettings): Promise<LspSettings> =>
      ipcRenderer.invoke(IpcChannel.LspSetSettings, settings) as Promise<LspSettings>,
  },
};

contextBridge.exposeInMainWorld('studio', studioApi);
