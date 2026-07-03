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
}
