/**
 * The local model-runtime payload contract shared between the main-process backend and the renderer.
 * These are the small, normalised shapes a
 * {@link import('../electron/contributions/model-runtime/model-runtime').ModelRuntime} maps its
 * runtime's native responses into — the renderer never sees Ollama's (or any other runtime's) wire
 * format, which is what keeps the view runtime-agnostic.
 */

/**
 * A model whose weights are installed locally, as the manager lists it.
 */
export interface LocalModel {
  /**
   * The fully-qualified model reference, including its tag (for example `llama3.2:3b`). This is the
   * identifier every other operation takes.
   */
  readonly name: string;

  /**
   * The on-disk size of the model's weights, in bytes.
   */
  readonly size: number;

  /**
   * The content digest of the model, or an empty string when the runtime does not report one.
   */
  readonly digest: string;

  /**
   * When the model was last modified, as an ISO-8601 string, or an empty string when unreported.
   */
  readonly modifiedAt: string;

  /**
   * The model family (for example `llama`, `qwen2`), or an empty string when unreported.
   */
  readonly family: string;

  /**
   * The human-readable parameter count (for example `3.2B`), or an empty string when unreported.
   */
  readonly parameterSize: string;

  /**
   * The quantisation level (for example `Q4_K_M`), or an empty string when unreported.
   */
  readonly quantization: string;
}

/**
 * A model currently loaded into memory by the runtime.
 */
export interface RunningModel {
  /**
   * The fully-qualified model reference.
   */
  readonly name: string;

  /**
   * The total size of the loaded model, in bytes.
   */
  readonly size: number;

  /**
   * How much of the model is resident in VRAM, in bytes. Zero means it is running on the CPU — the
   * distinction the manager surfaces, because it is the difference between fast and unusably slow.
   */
  readonly sizeVram: number;

  /**
   * When the runtime will unload the model, as an ISO-8601 string, or an empty string when unreported.
   */
  readonly expiresAt: string;
}

/**
 * The detailed metadata for one installed model, from the runtime's inspect operation. Richer than
 * {@link LocalModel} because it costs an extra round trip per model, so it is fetched on demand.
 */
export interface ModelDetails {
  /**
   * The fully-qualified model reference that was inspected.
   */
  readonly name: string;

  /**
   * The model family, or an empty string when unreported.
   */
  readonly family: string;

  /**
   * The human-readable parameter count, or an empty string when unreported.
   */
  readonly parameterSize: string;

  /**
   * The quantisation level, or an empty string when unreported.
   */
  readonly quantization: string;

  /**
   * The weights format (for example `gguf`), or an empty string when unreported.
   */
  readonly format: string;

  /**
   * The model's context length in tokens, or undefined when the runtime does not report it. Feeds
   * `AiModelInfo.contextWindow` when the connections cross-link lands.
   */
  readonly contextLength?: number;

  /**
   * The capabilities the runtime advertises for the model (for example `completion`, `tools`,
   * `vision`); empty when unreported.
   */
  readonly capabilities: readonly string[];
}

/**
 * Whether a model runtime's server is reachable, and its version when it is.
 */
export interface ModelRuntimeStatus {
  /**
   * Whether the server answered.
   */
  readonly available: boolean;

  /**
   * The server version, present only when {@link available} is true.
   */
  readonly version?: string;

  /**
   * Whether the reachable server is the one Studio started. False for a server the user is running
   * themselves, which Studio can talk to but must not stop — the manager disables its stop control
   * rather than killing a process it does not own.
   */
  readonly startedByStudio?: boolean;
}

/**
 * How a runtime's binary is installed on this machine.
 *
 * `system` is a binary the user installed themselves, found on the PATH or in a platform-standard
 * location; `managed` is one Studio downloaded into its own user-data directory; `absent` means
 * neither. Detection prefers `system`, so a user who already runs Ollama never pays for a second
 * multi-gigabyte copy.
 */
export type RuntimeInstallKind = 'absent' | 'system' | 'managed';

/**
 * Where a runtime's binary is, and how it got there.
 */
export interface RuntimeInstallation {
  /**
   * Which kind of installation was found.
   */
  readonly kind: RuntimeInstallKind;

  /**
   * The absolute path of the runtime executable, or an empty string when {@link kind} is `absent`.
   */
  readonly executable: string;

  /**
   * The version the binary reports, or an empty string when it could not be determined.
   */
  readonly version: string;
}

/**
 * Progress through a managed runtime install, pushed to the renderer while the download runs. The
 * runtime binaries are large enough (over a gigabyte on Linux and Windows) that a progressless install
 * reads as a hang.
 */
export interface RuntimeInstallProgress {
  /**
   * Which stage the install has reached.
   */
  readonly stage: 'downloading' | 'verifying' | 'extracting' | 'done' | 'failed';

  /**
   * Bytes downloaded so far.
   */
  readonly received: number;

  /**
   * The total bytes expected, or 0 when the server did not report a content length.
   */
  readonly total: number;

  /**
   * The failure reason, present only when {@link stage} is `failed`.
   */
  readonly error?: string;
}

/**
 * How much disk the runtime's model store is using.
 */
export interface ModelDiskUsage {
  /**
   * The total size of the installed model weights, in bytes.
   */
  readonly bytes: number;

  /**
   * The directory the weights live in, or an empty string when it could not be located.
   */
  readonly path: string;
}
