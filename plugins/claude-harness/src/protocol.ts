// The wire shapes an agent harness exchanges with Studio.
//
// Deliberately declared here rather than imported from the application's `@shared/api`: a harness is a
// separate program whose contract with Studio is the protocol, not shared TypeScript. A third-party
// harness would write these from the documented protocol, and a first-party one taking a shortcut into
// `src/` would quietly make itself unextractable — and would let a change in the app break a shipped
// plugin without anything noticing.
//
// This is the same rule `plugins/protocol/listing.ts` follows for decoders, and the in-repo stand-in
// for what would eventually be a published protocol package.

/**
 * The protocol version this harness speaks. Studio refuses a harness whose major differs, or whose
 * minor is newer than the build's.
 *
 * 1.9.0 is the version the parity port needed: `task.stop` and `panic` so background work can be
 * stopped, `cancel` so a prompt raced against claude.ai can be withdrawn, per-choice descriptions on
 * an `input` request, and `omit` on a `tools` request so this harness keeps its own clarifying-question
 * tool instead of being handed Studio's as well.
 */
export const PROTOCOL_VERSION: string = '1.10.0';

/**
 * What a harness declares it can do, once, at the handshake.
 *
 * 🔑 `answers` replaced the per-feature booleans in 1.5.0: it lists the host messages this harness will
 * reply to, and Studio refuses to send anything absent from it. That matters more than it sounds —
 * a host message that goes unanswered *hangs* rather than fails, so an unimplemented message must be
 * one Studio never sends rather than one this ignores.
 */
export interface Capabilities {
  readonly protocolVersion: string;
  readonly sessionModel: 'live-harness' | 'stateless';
  readonly answers: readonly string[];
  readonly images: boolean;
  readonly efforts: readonly string[];
  readonly resumable: boolean;
}

/**
 * A file, folder or editor selection the user attached to a turn.
 */
export interface ContextRef {
  readonly path: string;
  readonly kind: 'file' | 'folder' | 'selection';
  readonly content?: string;
}

/**
 * An image attached to a turn's input.
 */
export interface TurnImage {
  readonly mediaType: string;
  readonly data: string;
  readonly name?: string;
}

/**
 * The turn envelope Studio sends. Mirrors its `AgentRunContext` minus everything that cannot cross a
 * wire — the abort signal, the bridge and the callbacks are all messages instead.
 */
export interface TurnRequest {
  readonly requestId: string;
  readonly prompt: string;
  readonly workspaceRoot: string | null;
  readonly model: string;
  readonly agentSessionId: string | null;
  readonly effort: string | null;
  readonly mode: 'chat' | 'agent';
  readonly surface: string;
  readonly allowedWritePaths: readonly string[];
  readonly deniedWritePaths: readonly string[];
  readonly allowedNetworkLocations: readonly string[];
  readonly deniedNetworkLocations: readonly string[];
  readonly tokenCap: number;
  readonly resumeSessionId: string | null;
  readonly forkSession: boolean;
  readonly resumeSessionAt: string | null;
  readonly permissionPosture: 'prompt' | 'auto-edits' | 'auto-all';
  readonly toolPolicies: Readonly<Record<string, 'allow' | 'ask' | 'deny'>>;
  readonly images: readonly TurnImage[];
  readonly contextPaths: readonly ContextRef[];
  readonly remoteControl: 'off' | 'mirror' | 'control';
  readonly agentShell: string | null;
  readonly owningTabId: string | null;
  /**
   * Settings Studio holds on this plugin's behalf, whose meaning belongs to the plugin.
   *
   * ⛔ Opaque on the wire on purpose: the protocol must not name one vendor's concepts. `claudeExecutable`
   * is a key *this* harness understands, and every other plugin ignores a bag it put nothing in.
   */
  readonly providerSettings: Readonly<Record<string, unknown>>;
}

/**
 * A message Studio sends this harness.
 */
export type HostMessage =
  | {
      readonly type: 'initialize';
      readonly protocolVersion: string;
      readonly settings: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'turn.start'; readonly turn: TurnRequest }
  | { readonly type: 'turn.abort'; readonly requestId: string }
  | { readonly type: 'steer'; readonly requestId: string; readonly text: string }
  | { readonly type: 'remote-control'; readonly mode: 'off' | 'mirror' | 'control' }
  | { readonly type: 'discover'; readonly discoveryId: string }
  | { readonly type: 'task.stop'; readonly taskId: string }
  | { readonly type: 'panic' }
  | { readonly type: 'answer'; readonly callId: string; readonly answer: Answer };

/**
 * One of Studio's own tools, as described to this harness.
 *
 * ⛔ No implementation crosses. The harness learns a tool exists and what it takes; running it is a
 * `tool` request back to Studio, which is where the permission gate and the audit record live.
 */
export interface StudioTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

/**
 * The answer to a blocking question.
 *
 * ⚠️ Every one has a shape for "the user did not answer", because a turn can be aborted with a prompt
 * open. A harness must handle a refusal for everything it asks.
 */
export type Answer =
  | { readonly kind: 'permission'; readonly granted: boolean }
  | { readonly kind: 'input'; readonly answer: string | null }
  | { readonly kind: 'edit-decision'; readonly decision: 'yes' | 'no' }
  | { readonly kind: 'bridge'; readonly result: unknown; readonly error: string | null }
  | { readonly kind: 'credential'; readonly apiKey: string | null }
  | {
      readonly kind: 'tools';
      readonly tools: readonly StudioTool[];
      readonly systemPrompt: string;
    }
  | { readonly kind: 'tool'; readonly result: string | null; readonly error: string | null };

/**
 * One suggested answer to an `input` request. A description explains what picking it means.
 */
export interface Choice {
  readonly label: string;
  readonly description?: string;
}

/**
 * A blocking question this harness asks Studio.
 */
export type Request =
  | { readonly kind: 'permission'; readonly name: string; readonly detail: string }
  | { readonly kind: 'input'; readonly question: string; readonly choices: readonly Choice[] }
  | {
      readonly kind: 'edit-decision';
      readonly name: string;
      readonly detail: string;
      readonly hasDiff: boolean;
    }
  | {
      readonly kind: 'bridge';
      readonly capability: string;
      readonly input: unknown;
      readonly timeoutMs: number | null;
    }
  | { readonly kind: 'credential' }
  | { readonly kind: 'tools'; readonly omit?: readonly string[] }
  | { readonly kind: 'tool'; readonly name: string; readonly input: unknown };

/**
 * A model this harness reports it can run. ⛔ Two fields: the context window is core's to resolve.
 */
export interface HarnessModel {
  readonly id: string;
  readonly label?: string;

  /**
   * The model's context window in tokens, or undefined when the harness does not know (1.10.0).
   *
   * Studio used to resolve this from the id against a table of its own, which obliged it to know which
   * models every provider has. An omitted window falls back to one neutral default.
   */
  readonly contextWindow?: number;
}

/**
 * A message this harness sends Studio.
 *
 * `event` carries Studio's own `AiEvent` unchanged — the eighteen kinds its transcript already renders
 * — which is why a harness needs no output vocabulary of its own.
 */
export type HarnessMessage =
  | { readonly type: 'ready'; readonly capabilities: Capabilities }
  | { readonly type: 'event'; readonly event: Record<string, unknown> }
  | {
      readonly type: 'request';
      readonly callId: string;
      readonly requestId: string;
      readonly request: Request;
    }
  // Withdraws a question this harness no longer needs answered, because something else answered it —
  // a peer on claude.ai, under remote control. Studio dismisses its prompt and sends no answer.
  | { readonly type: 'cancel'; readonly callId: string }
  | {
      readonly type: 'audit';
      readonly requestId: string;
      readonly name: string;
      readonly detail: string;
      readonly source: string;
    }
  | {
      readonly type: 'turn.completed';
      readonly requestId: string;
      readonly sessionId: string | null;
    }
  | { readonly type: 'turn.failed'; readonly requestId: string; readonly error: string }
  | {
      readonly type: 'models';
      readonly discoveryId: string;
      readonly models: readonly HarnessModel[];
      readonly detail?: string;
    };
