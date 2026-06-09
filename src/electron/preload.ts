import { contextBridge } from 'electron';
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
};

contextBridge.exposeInMainWorld('studio', studioApi);
