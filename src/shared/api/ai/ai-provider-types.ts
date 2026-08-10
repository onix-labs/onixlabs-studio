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
 * Which Claude Code CLI the agent harness spawns. `bundled` uses the CLI shipped with Studio (tested
 * against the bundled Agent SDK); `system` uses the `claude` on the user's PATH (which may be newer
 * and self-updating, but is not version-matched to the SDK); `custom` uses an explicit path. Only the
 * Claude local-login harness reads this — API-based connections do not spawn a CLI.
 */
export type ClaudeExecutableMode = 'bundled' | 'system' | 'custom';

/**
 * The user's Claude CLI choice: the mode and, for {@link ClaudeExecutableMode.custom}, the absolute
 * path to the executable (ignored for other modes).
 */
export interface ClaudeExecutableChoice {
  /**
   * Gets which CLI to spawn.
   */
  readonly mode: ClaudeExecutableMode;

  /**
   * Gets the absolute path used when the mode is `custom` (empty otherwise).
   */
  readonly path: string;
}

/**
 * The default Claude CLI choice: the bundled CLI (backward-compatible with builds that predate the
 * setting).
 */
export const DEFAULT_CLAUDE_EXECUTABLE: ClaudeExecutableChoice = { mode: 'bundled', path: '' };

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
 * How an agent session is exposed to another machine via the provider's own Remote Control feature —
 * an abstract, provider-agnostic capability each provider implements (or not) through its underlying
 * harness rather than Studio wiring the bridge itself.
 *
 * - `off`: not exposed (the default).
 * - `mirror`: mirrored to the provider's remote surface as **view-only** — a peer can watch but not act.
 * - `control`: fully **remote-controllable** — a peer can drive the session, gated by an approval step
 *   before a peer message reaches it.
 */
export type AiRemoteControlMode = 'off' | 'mirror' | 'control';

/**
 * The remote-control modes in display order.
 */
export const AI_REMOTE_CONTROL_MODES: readonly AiRemoteControlMode[] = ['off', 'mirror', 'control'];

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

  /**
   * Gets a value indicating whether the provider can expose a session to another machine via its own
   * Remote Control feature ({@link AiRemoteControlMode}). Absent means no — the composer/tool-strip hides
   * the remote-control control for the provider then.
   */
  readonly supportsRemoteControl?: boolean;
}
