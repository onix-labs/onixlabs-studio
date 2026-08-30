// Static host facts exposed synchronously by the Electron preload as `window.host`, the counterpart
// to the generic `window.bridge` transport. These are values the renderer needs *synchronously at
// startup* — before the first paint, before any async round-trip — so they cannot travel over the
// asynchronous bridge: the host platform, and the display/GPU startup snapshot resolved by the main
// process before the window was created. Keep this module platform-neutral (types only).

/**
 * Describes the GPU-derived rendering recommendation resolved by the main process at startup. The
 * renderer uses it to seed (and explain) the "modern UI features" setting when that setting is left
 * on its automatic mode.
 */
export interface GpuRenderingInfo {
  /**
   * Gets a value indicating whether the active GPU is flagged as likely to render the heavier visual
   * effects poorly, so the renderer should fall back to plain rounded corners and reduced decorative
   * effects. Some GPUs (notably the Intel UHD 630) corrupt the GPU-rasterized squircle corner masks.
   */
  readonly recommendReducedEffects: boolean;

  /**
   * Gets a human-readable description of the active GPU (for example, its OpenGL renderer string),
   * shown in the settings hint. Empty when the GPU could not be identified.
   */
  readonly description: string;
}

/**
 * Describes the display state resolved before the first paint: the GPU rendering recommendation and
 * whether GPU hardware acceleration is enabled for this launch. A snapshot — the operations that
 * change these travel over the bridge, and take effect only after a relaunch.
 */
export interface DisplayStartup {
  /**
   * Gets the GPU-derived rendering recommendation resolved at startup.
   */
  readonly gpuRendering: GpuRenderingInfo;

  /**
   * Gets a value indicating whether GPU hardware acceleration is enabled for this launch (the
   * persisted preference applied before the app became ready).
   */
  readonly hardwareAccelerationEnabled: boolean;
}

/**
 * Describes the versions the running build is made of: Studio's own, and the runtimes underneath it.
 *
 * Carried with the startup facts rather than fetched, because the first thing that needs them is the
 * About dialog and the second is a bug report — and a user who cannot say what they are running files
 * a report nobody can act on. They are fixed for the life of the process, so a synchronous snapshot is
 * the honest shape.
 */
export interface HostVersions {
  /**
   * Gets Studio's own version, as published (calendar versioning).
   */
  readonly studio: string;

  /**
   * Gets the Electron version the build runs on.
   */
  readonly electron: string;

  /**
   * Gets the Chromium version behind the renderer.
   */
  readonly chromium: string;

  /**
   * Gets the Node version the main process runs.
   */
  readonly node: string;
}

/**
 * Describes the static host facts exposed on `window.host`, or undefined-able per field when the
 * renderer runs outside Electron (where the whole object is absent).
 */
export interface HostEnv {
  /**
   * Gets the operating-system platform (the Node `process.platform` value, e.g. `darwin`/`win32`).
   */
  readonly platform: string;

  /**
   * Gets the processor architecture the build runs on (the Node `process.arch` value, e.g. `arm64`).
   */
  readonly arch: string;

  /**
   * Gets the versions the running build is made of.
   */
  readonly versions: HostVersions;

  /**
   * Gets the current user's home directory (absolute), used to abbreviate paths to a leading `~`.
   */
  readonly homeDir: string;

  /**
   * Gets the display/GPU startup snapshot resolved before the first paint.
   */
  readonly display: DisplayStartup;
}
