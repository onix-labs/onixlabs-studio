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
export const PROTOCOL_VERSION: string = '1.8.0';

/**
 * What a harness declares it can do, once, at the handshake.
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
  | {
      readonly type: 'initialize';
      readonly protocolVersion: string;
      // Protocol 1.8.0. Which connection this harness serves, which it needs before it can say what it
      // can do — see the note on {@link ProviderSettings}.
      readonly settings?: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'turn.start'; readonly turn: TurnRequest }
  | { readonly type: 'turn.abort'; readonly requestId: string }
  | { readonly type: 'steer'; readonly requestId: string; readonly text: string }
  | { readonly type: 'answer'; readonly callId: string; readonly answer: Answer }
  | { readonly type: 'remote-control'; readonly mode: 'off' | 'mirror' | 'control' }
  | { readonly type: 'discover'; readonly discoveryId: string };

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
      readonly tools: readonly HarnessTool[];
      readonly systemPrompt: string;
    }
  | { readonly kind: 'tool'; readonly result: string | null; readonly error: string | null };

/**
 * One of Studio's own tools, as described to this harness.
 *
 * ⛔ No implementation crosses. The harness learns that a tool exists and what it takes; running it is a
 * `tool` request back to Studio, so the permission gate and the audit record stay where the user's
 * settings are enforced.
 */
export interface HarnessTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

/**
 * A model this harness reports it can run. Two fields: the context window is core's to resolve.
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
  | { readonly kind: 'credential' }
  | { readonly kind: 'tools' }
  | { readonly kind: 'tool'; readonly name: string; readonly input: unknown };

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
  | { readonly type: 'turn.failed'; readonly requestId: string; readonly error: string }
  | {
      readonly type: 'models';
      readonly discoveryId: string;
      readonly models: readonly HarnessModel[];
      // Protocol 1.8.0. Why the list is empty, read by Studio only when it is: "could not reach your
      // Ollama server" is something a user can go and fix, where "reported no models" is not.
      readonly detail?: string;
    };

/**
 * What Studio tells this harness about the connection it serves.
 *
 * ⛔ Read out of the opaque settings bag rather than named on the wire, which is the protocol's rule: it
 * must not name one vendor's concepts. These keys are this plugin's to understand, and every other
 * harness ignores a bag it put nothing in.
 *
 * ⚠️ Nothing here is a secret. The API key is obtained through the `credential` round-trip at the point
 * of use, never handed over with the connection's shape.
 */
export interface ProviderSettings {
  /**
   * Gets the provider family the connection runs through: `anthropic`, `openai`, `google`, `xai`,
   * `deepseek`, `ollama`, `openai-compatible` or `custom`.
   */
  readonly connectionKind: string;

  /**
   * Gets the connection's display label, used in failure messages so a user with three connections
   * knows which one could not run.
   */
  readonly connectionLabel: string;

  /**
   * Gets how the connection authenticates, which is how a local server that needs no key is told apart
   * from a keyed one that has not been configured.
   */
  readonly connectionAuth: string;

  /**
   * Gets the endpoint the user pointed the connection at, or null to use the kind's default.
   */
  readonly baseUrl: string | null;

  /**
   * Gets the extra HTTP headers a gateway requires on every request.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Reads the provider settings out of the bag Studio sent, with the defaults a missing field implies.
 * @param settings The settings bag, from the handshake or a turn envelope.
 * @returns Returns the settings this harness understands.
 */
export function readProviderSettings(
  settings: Readonly<Record<string, unknown>> | undefined,
): ProviderSettings {
  const source: Record<string, unknown> = settings ?? {};
  const text: (key: string, fallback: string) => string = (
    key: string,
    fallback: string,
  ): string => {
    const value: unknown = source[key];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  };
  const headers: unknown = source['headers'];
  const baseUrl: unknown = source['baseUrl'];
  return {
    // `custom` rather than a guess at a hosted provider: an unknown kind needs a base URL and says so,
    // where defaulting to one vendor's endpoint would send the user's prompt somewhere they did not ask.
    connectionKind: text('connectionKind', 'custom'),
    connectionLabel: text('connectionLabel', 'This connection'),
    connectionAuth: text('connectionAuth', 'api-key'),
    baseUrl: typeof baseUrl === 'string' ? baseUrl : null,
    headers:
      typeof headers === 'object' && headers !== null && !Array.isArray(headers)
        ? (headers as Record<string, string>)
        : {},
  };
}
