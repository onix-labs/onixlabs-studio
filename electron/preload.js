// Preload script — runs in an isolated context before the Angular renderer loads.
// Use contextBridge to expose a minimal, explicit API to the renderer instead of
// enabling full Node integration (which would be a security risk).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
  },
});
