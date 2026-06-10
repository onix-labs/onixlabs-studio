import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '../shared/ipc-channels';
import type { StudioApi } from '../shared/studio-api';

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
  },
};

contextBridge.exposeInMainWorld('studio', studioApi);
