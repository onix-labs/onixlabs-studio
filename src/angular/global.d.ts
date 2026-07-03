import type { Bridge } from '../shared/api/bridge';
import type { HostEnv } from '../shared/api/host';
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

    /**
     * Gets the static host facts exposed by the Electron preload (platform, display startup snapshot),
     * or undefined when the renderer runs outside Electron. The synchronous counterpart to
     * {@link bridge}, for values the async transport cannot provide before the first paint.
     */
    readonly host?: HostEnv;
  }
}
