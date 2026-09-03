import { FormatSlotEntry } from '@shared/api/format-slot';

/**
 * Describes how to spawn a decoder. Decided entirely by the main process; the renderer only ever names
 * a format, never a command.
 */
export interface DecoderSpec {
  /**
   * Gets the executable to spawn.
   */
  readonly command: string;

  /**
   * Gets the arguments passed to the executable.
   */
  readonly args: readonly string[];

  /**
   * Gets the environment overlaid on the spawned process's environment, or undefined to inherit the
   * current environment unchanged.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Describes the outcome of resolving a decoder: the spawn specification when it is available, otherwise
 * a human-readable reason it is not — so the panel can explain why a format shows nothing rather than
 * simply showing nothing.
 */
export type DecoderResolution =
  | { readonly available: true; readonly spec: DecoderSpec }
  | { readonly available: false; readonly reason: string };

/**
 * Builds an unavailable resolution.
 * @param reason The reason the decoder cannot run, phrased for the user.
 * @returns Returns the resolution.
 */
export function decoderUnavailable(reason: string): DecoderResolution {
  return { available: false, reason };
}

/**
 * Describes one decoder registered into the format slot, and how to start it.
 *
 * Mirrors the language-server and debug-adapter descriptors deliberately: a decoder is the same kind of
 * thing as those — an implementation a plugin contributes into a slot the application defines — and
 * differs only in being keyed by format rather than by language.
 */
export interface DecoderDescriptor extends FormatSlotEntry {
  /**
   * Resolves how to start this decoder, or why it cannot be started.
   *
   * Never installs anything: a decoder that is not installed resolves to unavailable and the user
   * installs it in the Plugin Manager, rather than opening a file silently triggering a download.
   * @returns Returns the resolution.
   */
  readonly resolve: () => DecoderResolution;
}
