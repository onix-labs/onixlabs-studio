// Shared AI-agent provider/model contract, platform-neutral (types only) so both the Electron
// back-end and the Angular front-end can import it.

/**
 * Identifies an agent provider — the id of the {@link AiConnection} it runs. Since connections are
 * user-authored data (add/remove/rename at runtime), this is any connection id rather than a fixed
 * union; the built-in seeds keep the stable ids `claude`, `vercel`, and `ollama`.
 */
export type AiProviderId = string;

/**
 * A reasoning-effort level an agent can run a turn at, ordered least to most. This is the superset
 * across providers; each provider declares the subset it supports ({@link AiProviderInfo.supportedEfforts})
 * and clamps a requested level into its own range (e.g. Claude has no `minimal`, Codex no `max`).
 */
export type AiEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * The reasoning-effort levels in ascending order, for clamping and UI ordering.
 */
export const AI_EFFORT_LEVELS: readonly AiEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

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

  /**
   * Gets the reasoning-effort levels this provider offers, least to most, or absent/empty when it has no
   * selectable effort (the `/effort` command is hidden then). Drives both the command's visibility and
   * the levels it offers.
   */
  readonly supportedEfforts?: readonly AiEffort[];
}
