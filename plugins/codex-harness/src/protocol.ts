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
 */
export const PROTOCOL_VERSION: string = '1.3.0';

/**
 * What a harness declares it can do, once, at the handshake.
 */
export interface Capabilities {
  readonly protocolVersion: string;
  readonly sessionModel: 'live-harness' | 'stateless';
  readonly steering: boolean;
  readonly images: boolean;
  readonly efforts: readonly string[];
  readonly resumable: boolean;
  readonly remoteControl: boolean;
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
  readonly images: readonly { readonly mediaType: string; readonly data: string }[];
  readonly contextPaths: readonly {
    readonly path: string;
    readonly kind: 'file' | 'folder' | 'selection';
    readonly content?: string;
  }[];
  readonly remoteControl: 'off' | 'mirror' | 'control';
  readonly agentShell: string | null;
  readonly owningTabId: string | null;
  readonly providerSettings: Readonly<Record<string, unknown>>;
}

/**
 * A message Studio sends this harness.
 */
export type HostMessage =
  | { readonly type: 'initialize'; readonly protocolVersion: string }
  | { readonly type: 'turn.start'; readonly turn: TurnRequest }
  | { readonly type: 'turn.abort'; readonly requestId: string }
  | { readonly type: 'steer'; readonly requestId: string; readonly text: string }
  | { readonly type: 'answer'; readonly callId: string; readonly answer: Answer }
  | { readonly type: 'remote-control'; readonly mode: 'off' | 'mirror' | 'control' };

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
  | { readonly kind: 'credential'; readonly apiKey: string | null };

/**
 * A blocking question this harness asks Studio.
 */
export type Request =
  | { readonly kind: 'permission'; readonly name: string; readonly detail: string }
  | { readonly kind: 'input'; readonly question: string; readonly choices: readonly string[] }
  | {
      readonly kind: 'edit-decision';
      readonly name: string;
      readonly detail: string;
      readonly hasDiff: boolean;
    }
  | { readonly kind: 'credential' };

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
  | { readonly type: 'turn.failed'; readonly requestId: string; readonly error: string };
