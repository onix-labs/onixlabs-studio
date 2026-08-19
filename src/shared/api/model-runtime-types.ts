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
}
