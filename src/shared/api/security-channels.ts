/**
 * Names the security IPC channels, and the types their payloads carry. This is the security
 * capability's slice of the IPC contract: the shared security client and the main-process security
 * manager name their channels from here, over the generic {@link import('./bridge').Bridge} transport.
 * The image-source policy is owned and enforced by the main process (it builds the CSP header before
 * the page loads) and persisted across launches, so this is app-wide shared plumbing.
 */
export enum SecurityChannel {
  /**
   * Gets the current image-source policy enforced by the Content-Security-Policy (invoke).
   */
  GetImagePolicy = 'security:get-image-policy',

  /**
   * Sets and persists the image-source policy; takes effect on the next window load (invoke).
   */
  SetImagePolicy = 'security:set-image-policy',
}

/**
 * Identifies which image sources the Content-Security-Policy permits the renderer to load.
 *
 * - `local`: only bundled, `data:` and `blob:` images — no remote loads (the safest default).
 * - `https`: additionally allow images served over `https:`.
 * - `all`: additionally allow images served over plain `http:` (the least safe).
 *
 * The policy is owned and enforced by the main process (it builds the CSP header before the page
 * loads) and persisted across launches. A change takes effect the next time the window loads.
 */
export type ImageSourcePolicy = 'local' | 'https' | 'all';
