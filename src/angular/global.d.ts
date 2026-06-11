import type { StudioApi } from '../shared/studio-api';

declare global {
  interface Window {
    /**
     * Gets the Studio bridge exposed by the Electron preload, or undefined when the renderer runs
     * outside Electron (for example, served as a plain web app or under unit tests).
     */
    readonly studio?: StudioApi;
  }
}
