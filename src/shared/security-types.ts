// Shared security contract between the Electron (back-end) and Angular (front-end) processes.
// Keep this module platform-neutral (types only — no Node or DOM dependencies) so both compilation
// targets can import it.

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

/**
 * Defines the security operations exposed to the renderer process.
 */
export interface SecurityApi {
  /**
   * Gets the current image-source policy enforced by the Content-Security-Policy.
   * @returns Returns the active {@link ImageSourcePolicy}.
   */
  getImagePolicy(): Promise<ImageSourcePolicy>;

  /**
   * Sets the image-source policy, persisting it for subsequent launches. The change takes effect the
   * next time the window loads.
   * @param policy The policy to apply.
   * @returns Returns the stored {@link ImageSourcePolicy} (the resolved value after validation).
   */
  setImagePolicy(policy: ImageSourcePolicy): Promise<ImageSourcePolicy>;
}
