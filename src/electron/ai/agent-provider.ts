import type { AiEvent, AiProviderId } from '../../shared/ai-types';

/**
 * Reports whether a provider can currently run, with a reason suitable for display.
 */
export interface ProviderAvailability {
  /**
   * Gets a value indicating whether the provider has what it needs to run.
   */
  readonly available: boolean;

  /**
   * Gets a short human-readable description of the availability.
   */
  readonly detail: string;
}

/**
 * The credential material a provider authenticates a run with. The Claude provider can use either the
 * local login or an API key; API-only providers (e.g. Vercel) require the key.
 */
export interface AgentAuth {
  /**
   * Gets a value indicating whether a local Claude login is present.
   */
  readonly hasLocalLogin: boolean;

  /**
   * Gets the available API key, or null when none is available.
   */
  readonly apiKey: string | null;
}

/**
 * Lets a provider invoke an in-app capability that lives in the renderer (read/write the live editor,
 * etc.) during a run.
 */
export interface AgentBridge {
  /**
   * Invokes an in-app capability and resolves with its result.
   * @param capability The capability name.
   * @param input The capability input.
   * @returns Returns the capability's result.
   */
  request(capability: string, input: unknown): Promise<unknown>;
}

/**
 * The context for a single agent run: the prompt and scope, the resolved credential, an abort signal,
 * the in-app capability bridge, the permission prompt, and the sink that streams provider-agnostic
 * events back to the renderer.
 */
export interface AgentRunContext {
  /**
   * Gets the identifier correlating this run with its streamed events.
   */
  readonly requestId: string;

  /**
   * Gets the user's prompt.
   */
  readonly prompt: string;

  /**
   * Gets the workspace root the agent should act within, or null for none.
   */
  readonly workspaceRoot: string | null;

  /**
   * Gets the credential the run authenticates with.
   */
  readonly auth: AgentAuth;

  /**
   * Gets the signal that aborts the run when the user stops it.
   */
  readonly signal: AbortSignal;

  /**
   * Gets the bridge to the renderer's in-app capabilities.
   */
  readonly bridge: AgentBridge;

  /**
   * Asks the user to permit a gated action, resolving once they answer (or false if the run aborts).
   * @param name The display name of the action requesting permission.
   * @param detail A one-line summary of what the action will do.
   * @returns Returns true when the user grants permission.
   */
  requestPermission(name: string, detail: string): Promise<boolean>;

  /**
   * Emits a streamed event for this run.
   * @param event The event to emit (its `requestId` must match this run).
   */
  emit(event: AiEvent): void;
}

/**
 * A provider-agnostic agent implementation. Concrete providers (Claude Agent SDK, Vercel AI SDK) wrap
 * their own SDK behind this seam and parse their output into the shared {@link AiEvent} protocol.
 */
export interface AgentProvider {
  /**
   * Gets the provider's stable identifier.
   */
  readonly id: AiProviderId;

  /**
   * Gets the provider's human-readable label.
   */
  readonly label: string;

  /**
   * Reports whether the provider can run with the given credential.
   * @param auth The resolved credential material.
   * @returns Returns the availability descriptor.
   */
  describeAvailability(auth: AgentAuth): ProviderAvailability;

  /**
   * Runs a single agent turn, streaming events through the context until the turn ends or aborts.
   * @param context The run context.
   */
  run(context: AgentRunContext): Promise<void>;
}
