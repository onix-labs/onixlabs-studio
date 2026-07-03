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
import { AppChannel } from '@shared/api/app-channels';
import type { DisplayStartup, HostEnv } from '@shared/api/host';
import { IpcChannel } from '@shared/ipc-channels';
import type { StudioApi } from '../shared/studio-api';

/**
 * Holds the display startup state read synchronously from the main process, before the first paint,
 * so the renderer can seed its corner/effects policy without a squircle-to-round flash. The main
 * process resolved these from the active GPU and the persisted startup preferences by the time this
 * preload runs.
 */
const displayStartup: DisplayStartup = ipcRenderer.sendSync(
  AppChannel.GetDisplayStartup,
) as DisplayStartup;

/**
 * Specifies the static host facts exposed to the renderer under `window.host`: values needed
 * synchronously at startup that cannot travel over the async `window.bridge`.
 */
const host: HostEnv = {
  platform: process.platform,
  display: displayStartup,
};

/**
 * Specifies the concrete API exposed to the renderer under `window.studio`.
 */
const studioApi: StudioApi = {
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
};

contextBridge.exposeInMainWorld('studio', studioApi);
contextBridge.exposeInMainWorld('host', host);

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
