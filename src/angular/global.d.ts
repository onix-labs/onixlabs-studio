import type { Bridge } from '../shared/api/bridge';
import type { StudioApi } from '../shared/studio-api';

declare global {
  interface Window {
    /**
     * Gets the Studio bridge exposed by the Electron preload, or undefined when the renderer runs
     * outside Electron (for example, served as a plain web app or under unit tests). Being migrated
     * feature by feature onto the generic {@link bridge}.
     */
    readonly studio?: StudioApi;

    /**
     * Gets the generic renderer↔main transport exposed by the Electron preload, or undefined when the
     * renderer runs outside Electron. Feature client services wrap this instead of {@link studio}.
     */
    readonly bridge?: Bridge;
  }
}
