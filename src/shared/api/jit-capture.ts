import { CodeListing } from './code-listing';

// The JIT capture contract shared between the Electron main process and the renderer. Keep this module
// platform-neutral (no Node or DOM dependencies) so both compilation targets can import it.

/**
 * Names the optimisation tier a capture asks the JIT for.
 *
 * A user-visible choice rather than an implementation detail: the same method is markedly different
 * code at each tier, and a reader looking at cold Tier0 output while believing it optimised would draw
 * the wrong conclusion about their own code.
 */
export type JitTier = 'tier0' | 'full-opts';

/**
 * Describes what a JIT capture produced: the listing, or the reason there is none.
 */
export type JitCaptureResult =
  | {
      readonly ok: true;

      /**
       * Gets the captured listing.
       */
      readonly listing: CodeListing;

      /**
       * Gets a value indicating whether the program had to be stopped before it exited. What it
       * printed before the stop is still in the listing.
       */
      readonly stopped: boolean;
    }
  | { readonly ok: false; readonly error: string };
