/**
 * Names the application-lifecycle IPC channels: the close-confirmation round-trip that lets the
 * renderer save or confirm unsaved work before the window closes. This is the app capability's slice
 * of the IPC contract: the shared lifecycle client and the main-process handler name their channels
 * from here, over the generic {@link import('./bridge').Bridge} transport.
 */
export enum AppChannel {
  /**
   * The main process asks the renderer whether the window may close (main→renderer, send). The
   * renderer must eventually answer with {@link AppChannel.ConfirmClose}.
   */
  RequestClose = 'app:request-close',

  /**
   * The renderer tells the main process whether the window may close (renderer→main, send).
   */
  ConfirmClose = 'app:confirm-close',

  /**
   * Synchronously reports the display startup snapshot (the GPU rendering recommendation and whether
   * hardware acceleration is enabled), read once by the preload before the first paint to build
   * `window.host`. This is the one `sendSync` channel; it is not reached over the async {@link Bridge}.
   */
  GetDisplayStartup = 'app:get-display-startup',

  /**
   * Persists the GPU hardware-acceleration preference; takes effect after the next relaunch, since
   * hardware acceleration can only be toggled before the app is ready (invoke).
   */
  SetHardwareAcceleration = 'app:set-hardware-acceleration',

  /**
   * Relaunches the application so a startup-only preference change can take effect (send).
   */
  Relaunch = 'app:relaunch',
}
