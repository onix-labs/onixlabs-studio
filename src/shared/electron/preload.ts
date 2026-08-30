import { contextBridge, IpcRendererEvent, ipcRenderer } from 'electron';
import type { Bridge } from '@shared/api/bridge';
import { AppChannel } from '@shared/api/app-channels';
import type { DisplayStartup, HostEnv, HostVersions } from '@shared/api/host';

/**
 * Holds the display startup state read synchronously from the main process, before the first paint,
 * so the renderer can seed its corner/effects policy without a squircle-to-round flash. The main
 * process resolved these from the active GPU and the persisted startup preferences by the time this
 * preload runs.
 */
const startup: DisplayStartup & { homeDir: string; versions: HostVersions } = ipcRenderer.sendSync(
  AppChannel.GetDisplayStartup,
) as DisplayStartup & { homeDir: string; versions: HostVersions };

/**
 * Specifies the static host facts exposed to the renderer under `window.host`: values needed
 * synchronously at startup that cannot travel over the async `window.bridge`.
 */
const host: HostEnv = {
  platform: process.platform,
  arch: process.arch,
  versions: startup.versions,
  homeDir: startup.homeDir,
  display: {
    gpuRendering: startup.gpuRendering,
    hardwareAccelerationEnabled: startup.hardwareAccelerationEnabled,
  },
};

contextBridge.exposeInMainWorld('host', host);

/**
 * Specifies the generic renderer↔main transport exposed to the renderer under `window.bridge`. It
 * names no feature: it forwards raw channel names to the underlying `ipcRenderer`, stripping the
 * Electron event from main→renderer messages so listeners receive only the payload. Each feature's
 * typed client service wraps this over its own `shared/api` channel slice.
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
