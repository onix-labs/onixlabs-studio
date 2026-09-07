// The contract behind the setup wizard's environment step: what the main process was asked to look
// for on this machine, and what it found. Kept platform-neutral (types only).

/**
 * Names a thing the environment step checks for.
 *
 * This is a closed union, and that is the security boundary. The renderer asks for a probe by
 * identifier; it never sends a command, a path, or an argument vector. A probe that took any of those
 * from the renderer would be a way to run an arbitrary binary from an untrusted process, which is
 * exactly what the bridge exists to prevent.
 */
export type SetupProbeId = 'git' | 'git-identity' | 'dotnet' | 'java' | 'node' | 'clangd';

/**
 * Describes how a probe turned out.
 *
 * `warn` and `missing` are deliberately separate. Missing means the thing is not there at all;
 * warning means it is there but incompletely set up — git installed with no identity configured is
 * the case that motivated the distinction, because it fails much later and for a reason that looks
 * nothing like its cause.
 *
 * `unknown` is what a probe that timed out reports. It is not `missing`: a slow answer is not a
 * negative one, and telling a user their toolchain is absent because a spawn was slow would be its
 * own species of the surprise this step exists to prevent.
 */
export type SetupProbeStatus = 'ok' | 'warn' | 'missing' | 'unknown';

/**
 * The outcome of one probe.
 */
export interface SetupProbeResult {
  /**
   * Gets the probe this describes.
   */
  readonly id: SetupProbeId;

  /**
   * Gets how it turned out.
   */
  readonly status: SetupProbeStatus;

  /**
   * Gets what was found, in the user's terms — a version string, or why nothing was found. Shown
   * beside the probe, so it is written to be read rather than parsed.
   */
  readonly detail: string;
}

/**
 * The git identity commits are attributed to, as configured globally.
 */
export interface GitIdentity {
  /**
   * Gets the configured `user.name`, or the empty string when unset.
   */
  readonly name: string;

  /**
   * Gets the configured `user.email`, or the empty string when unset.
   */
  readonly email: string;
}

/**
 * The channels the setup wizard's environment step speaks over.
 */
export enum SetupChannel {
  /**
   * Runs every environment probe and returns their results (invoke). Takes no arguments: the probe
   * set is fixed in the main process.
   */
  Probe = 'setup:probe',

  /**
   * Reads the globally configured git identity (invoke).
   */
  GetGitIdentity = 'setup:get-git-identity',

  /**
   * Writes the globally configured git identity, returning what git holds afterwards (invoke).
   */
  SetGitIdentity = 'setup:set-git-identity',
}
