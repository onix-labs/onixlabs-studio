import type {
  AgentContextRef,
  AgentMode,
  AgentSurface,
  AiEvent,
  AiInputChoice,
  AiModelInfo,
  AiPermissionPosture,
  AiProviderId,
} from '@shared/api/ai-types';

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
   * Gets the identifier of the model to run the turn with (already resolved to one the provider
   * offers).
   */
  readonly model: string;

  /**
   * Gets how much the agent may do without asking the user first.
   */
  readonly permissionPosture: AiPermissionPosture;

  /**
   * Gets the per-request token budget the turn is capped to, or 0 for no cap.
   */
  readonly tokenCap: number;

  /**
   * Gets the identifier of the editor tab that owns this run, so the in-app editor tools act on that
   * tab's editor; null when the run has no owning editor (the standalone agent tab).
   */
  readonly owningTabId: string | null;

  /**
   * Gets what this run acts on, which selects the tool set the providers expose: the open editor
   * document (`editor`) or the owning terminal (`terminal`).
   */
  readonly surface: AgentSurface;

  /**
   * Gets how much autonomy the agent runs with: `agent` (full tools) or `chat` (read-only — it may
   * inspect but never edits or executes).
   */
  readonly mode: AgentMode;

  /**
   * Gets the files and folders the user attached to the run's context, referenced by path for the
   * agent to read with its own file tools. Empty when nothing is attached.
   */
  readonly contextPaths: readonly AgentContextRef[];

  /**
   * Gets the provider session to resume so the model keeps the conversation's prior context, or null
   * to start a fresh session (a conversation's first turn). Providers that do not support session
   * continuation ignore it.
   */
  readonly resumeSessionId: string | null;

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
   * Asks the user a question on the agent's behalf, resolving once they answer (or null when they
   * decline or the run aborts). The provider blocks on the answer exactly as it blocks on a
   * permission decision.
   * @param question The question the agent is asking.
   * @param choices The suggested answers, or empty for a free-form question.
   * @returns Returns the user's answer, or null when they declined.
   */
  requestInput(question: string, choices: readonly AiInputChoice[]): Promise<string | null>;

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
   * Gets the models the provider can run a turn with, in display order.
   */
  readonly models: readonly AiModelInfo[];

  /**
   * Gets the identifier of the provider's default model (always present in {@link models}).
   */
  readonly defaultModelId: string;

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
