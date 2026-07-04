import type { Bridge } from '@shared/api/bridge';
import type { HostEnv } from '@shared/api/host';

declare global {
  interface Window {
    /**
     * Gets the generic renderer↔main transport exposed by the Electron preload, or undefined when the
     * renderer runs outside Electron. Feature client services wrap this over their own `shared/api`
     * channel slice.
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
