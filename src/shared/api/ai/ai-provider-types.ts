// Shared AI-agent provider/model contract, platform-neutral (types only) so both the Electron
// back-end and the Angular front-end can import it.

/**
 * Identifies an agent provider implementation.
 *
 * - `claude`: the Claude Agent SDK (local login or API key; deep local agentic capability).
 * - `vercel`: the Vercel AI SDK (API key only; the seam to additional model back-ends later).
 * - `ollama`: a local Ollama server (no credentials; runs open models like Qwen on the user's machine).
 */
export type AiProviderId = 'claude' | 'vercel' | 'ollama';

/**
 * Describes a model a provider can run a turn with.
 */
export interface AiModelInfo {
  /**
   * Gets the model's stable identifier (the value passed to the provider SDK, e.g. `claude-opus-4-8`).
   */
  readonly id: string;

  /**
   * Gets the model's human-readable label (e.g. `Opus 4.8`).
   */
  readonly label: string;

  /**
   * Gets the model's context window in tokens, so the renderer can show how full the conversation's
   * context is (the token readout's denominator).
   */
  readonly contextWindow: number;

  /**
   * Gets a value indicating whether the user pinned this model to the top of the picker. Absent means
   * not pinned.
   */
  readonly pinned?: boolean;

  /**
   * Gets a value indicating whether the user hid this model from the picker (kept in the list but not
   * offered for selection). Absent means visible.
   */
  readonly hidden?: boolean;
}

/**
 * Describes a registered provider and whether it can currently run.
 */
export interface AiProviderInfo {
  /**
   * Gets the provider's stable identifier.
   */
  readonly id: AiProviderId;

  /**
   * Gets the provider's human-readable label.
   */
  readonly label: string;

  /**
   * Gets a value indicating whether the provider has what it needs to run (credentials, etc.).
   */
  readonly available: boolean;

  /**
   * Gets a short human-readable description of the provider's availability.
   */
  readonly detail: string;

  /**
   * Gets the models the provider can run a turn with, in display order.
   */
  readonly models: readonly AiModelInfo[];

  /**
   * Gets the identifier of the provider's default model (always present in {@link models}).
   */
  readonly defaultModelId: string;

  /**
   * Gets a value indicating whether the provider accepts image input (the composer rejects images at
   * compose time otherwise). Absent means no.
   */
  readonly supportsImages?: boolean;
}
