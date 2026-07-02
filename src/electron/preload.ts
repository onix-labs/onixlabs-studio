import { contextBridge, IpcRendererEvent, ipcRenderer } from 'electron';
import type { Bridge } from '@shared/api/bridge';
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
import { IpcChannel } from '@shared/ipc-channels';
import type {
  LspExit,
  LspMessage,
  LspSettings,
  LspStartRequest,
  LspStartResult,
} from '../shared/lsp-types';
import type {
  GitRunResult,
  GpuRenderingInfo,
  RepositoryInfo,
  StudioApi,
} from '../shared/studio-api';

/**
 * Holds the display startup state read synchronously from the main process, before the first paint,
 * so the renderer can seed its corner/effects policy without a squircle-to-round flash. The main
 * process resolved these from the active GPU and the persisted startup preferences by the time this
 * preload runs.
 */
const displayStartup: { gpuRendering: GpuRenderingInfo; hardwareAccelerationEnabled: boolean } =
  ipcRenderer.sendSync(IpcChannel.AppGetDisplayStartup) as {
    gpuRendering: GpuRenderingInfo;
    hardwareAccelerationEnabled: boolean;
  };

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
  display: {
    gpuRendering: displayStartup.gpuRendering,
    hardwareAccelerationEnabled: displayStartup.hardwareAccelerationEnabled,
    setHardwareAcceleration: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.AppSetHardwareAcceleration, enabled) as Promise<void>,
    relaunch: (): void => ipcRenderer.send(IpcChannel.AppRelaunch),
  },
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
  shell: {
    openPath: (path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.ShellOpenPath, path) as Promise<void>,
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.ShellOpenExternal, url) as Promise<void>,
  },
  sourceControl: {
    openRepository: (): Promise<RepositoryInfo | null> =>
      ipcRenderer.invoke(IpcChannel.SourceControlOpenRepository) as Promise<RepositoryInfo | null>,
    resolveRepository: (directory: string): Promise<RepositoryInfo | null> =>
      ipcRenderer.invoke(
        IpcChannel.SourceControlResolveRepository,
        directory,
      ) as Promise<RepositoryInfo | null>,
    closeRepository: (root: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.SourceControlCloseRepository, root) as Promise<void>,
    status: (root: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlStatus, root) as Promise<GitRunResult>,
    log: (root: string, limit: number): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlLog, root, limit) as Promise<GitRunResult>,
    refs: (root: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlRefs, root) as Promise<GitRunResult>,
    stashes: (root: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlStashes, root) as Promise<GitRunResult>,
    commitFiles: (root: string, hash: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlCommitFiles, root, hash) as Promise<GitRunResult>,
    readBlob: (root: string, revision: string, filePath: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(
        IpcChannel.SourceControlReadBlob,
        root,
        revision,
        filePath,
      ) as Promise<GitRunResult>,
    stage: (root: string, paths: readonly string[]): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlStage, root, paths) as Promise<GitRunResult>,
    unstage: (root: string, paths: readonly string[]): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlUnstage, root, paths) as Promise<GitRunResult>,
    commit: (root: string, message: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlCommit, root, message) as Promise<GitRunResult>,
    stash: (root: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlStash, root) as Promise<GitRunResult>,
    checkout: (root: string, branch: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlCheckout, root, branch) as Promise<GitRunResult>,
    createBranch: (root: string, name: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlCreateBranch, root, name) as Promise<GitRunResult>,
    fetch: (root: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlFetch, root) as Promise<GitRunResult>,
    pull: (root: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(IpcChannel.SourceControlPull, root) as Promise<GitRunResult>,
    push: (root: string, remote?: string, branch?: string): Promise<GitRunResult> =>
      ipcRenderer.invoke(
        IpcChannel.SourceControlPush,
        root,
        remote,
        branch,
      ) as Promise<GitRunResult>,
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

/**
 * Specifies the generic renderer↔main transport exposed to the renderer under `window.bridge`. Unlike
 * `window.studio`, it names no feature: it forwards raw channel names to the underlying `ipcRenderer`,
 * stripping the Electron event from main→renderer messages so listeners receive only the payload. Each
 * feature's typed client service wraps this, replacing its slice of the old `window.studio`.
 */
const bridge: Bridge = {
  invoke: <T>(channel: string, ...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>,
  send: (channel: string, ...args: unknown[]): void => {
    ipcRenderer.send(channel, ...args);
  },
  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    const handler: (event: IpcRendererEvent, ...args: unknown[]) => void = (
      _event: IpcRendererEvent,
      ...args: unknown[]
    ): void => listener(...args);
    ipcRenderer.on(channel, handler);
    return (): void => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};

contextBridge.exposeInMainWorld('bridge', bridge);
