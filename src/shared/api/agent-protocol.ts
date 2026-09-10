import { AiEvent } from './ai/ai-event-types';

// The agent protocol: the wire an out-of-process agent harness and Studio speak (#653 phase 2).
//
// Written as types plus a validator rather than as prose, following the plugin manifest (#294): the
// host has something to use, and the shape is held to by tests rather than by a document somebody has
// to remember to re-read.
//
// Three things speak it: `HarnessHost` on Studio's side, the reference `echo-harness.mjs` that the
// transport test spawns for real, and the Claude harness plugin. It was defined before any of them
// existed, which was deliberate — the protocol is the commitment, and it is far cheaper to argue with a
// type than with an implementation.
//
// ## The shape, and why it is smaller than it looks
//
// The half that streams **already exists**. `AiEvent` is a serialisable discriminated union of
// eighteen kinds that already crosses IPC to the renderer, so a harness's output needs no new
// vocabulary at all — it emits the events Studio already renders. Inventing a second one would mean
// maintaining a translation nobody asked for.
//
// What has to be designed is everything that is *not* a stream:
//
//   - the **turn envelope**: `AgentRunContext` minus the things that cannot cross a wire;
//   - the **blocking round-trips** where the harness stops and asks Studio a question;
//   - **steering**, the one message that travels the other way mid-turn;
//   - the **handshake**, so a version mismatch is refused rather than half-honoured.
//
// ## ⛔ The envelope never carries a secret
//
// A harness that needs a credential Studio holds **asks for it** (`kind: 'credential'`) rather than
// being handed it at turn start. Three reasons, in order of how likely each is to bite:
//
//   1. Studio owns this protocol and has no second implementer keeping it honest, so the first thing
//      anyone does when debugging it is dump the wire. A secret in the envelope is a secret in
//      `studio.log` the day somebody adds a trace; a secret that is never in the envelope cannot be.
//   2. A `live-harness` session outlives a turn, so a pushed key would sit in another process's memory
//      for the life of the session with no way to rotate or revoke it.
//   3. Only the harness that needs one gets one. `authFor` can return a key even for a `claude-login`
//      connection (the `ANTHROPIC_API_KEY` development fallback), and the Claude harness — which
//      authenticates through the CLI's own store — has no business receiving it.
//
// ⚠️ The two `has*Login` flags are deliberately *not* secrets and are not modelled here at all: whether
// `~/.claude` exists is Studio's question to answer about a provider, not something a harness is told.
//
// ## What cannot cross, and what replaces it
//
// | In `AgentRunContext` | Why it cannot be sent | Replacement |
// | --- | --- | --- |
// | `signal: AbortSignal` | A live object | A `turn.abort` message |
// | `bridge: AgentBridge` | An object with a method | `request.bridge` round-trips |
// | `requestPermission`, `requestInput`, `requestEditDecision` | Functions returning promises | Request/response pairs correlated by `callId` |
// | `setSteerHandler` | Registers a callback | A `capabilities.steering` flag plus `steer` messages |
// | `emit` | A function | The harness simply sends `event` messages |
//
// ⚠️ Everything arriving from a harness is **untrusted**. It is another program, possibly one Studio
// downloaded, so every inbound message goes through {@link parseHarnessMessage} and a message that
// does not validate is refused rather than partially believed — the same rule the plugin manifest
// applies to a manifest.

/**
 * The protocol version this build implements, as semver.
 *
 * The same contract as `PLUGIN_API_VERSION`: a harness declares the version it was written against and
 * Studio decides whether it can honour it. A **newer minor** is refused rather than tolerated, because
 * a harness written against a later version may rely on a message this build will silently ignore, and
 * an agent turn that quietly does less is worse than one that refuses to start.
 *
 * `1.0.0` was the initial vocabulary: the turn envelope, `AiEvent` as the output stream, four blocking
 * round-trips, steering, and the handshake. **It was never published** — no release artifact ever spoke
 * it — which is why `1.1.0` was free to make `audit.requestId` required rather than optional. There is
 * no 1.0.0 harness in the world to stay compatible with, and pretending otherwise would have meant
 * carrying an unattributable audit record forever to protect nothing.
 *
 * `1.1.0` adds:
 *   - the **credential** round-trip, a fifth blocking request, so a harness can obtain a secret Studio
 *     holds rather than one it can find for itself;
 *   - `requestId` on `audit`, so an executed action is attributable to the turn that executed it.
 *
 * `1.4.0` adds **model discovery**. `AiManager.discoverModels` branched on the connection's auth kind —
 * the last place core read a vendor's identity to decide what to do — so a harness had no way to say
 * what it can run and a plugin provider could only ever offer models typed in by hand.
 *
 * 🔑 A discovery reuses the turn machinery rather than inventing a second one: its `discoveryId` is a
 * run id like any other, so a harness that needs to ask Studio something first (an API key, most
 * obviously) asks under that id and the host routes the answer exactly as it would mid-turn. The
 * alternative — a request belonging to no run — would have meant relaxing the rule that an unknown run
 * is refused, which is the rule that stops a harness asking questions nothing is waiting for.
 *
 * ⛔ A harness reports `{ id, label? }` and nothing more. The context window is resolved in core from
 * the id, because that is a fact about a model rather than about the harness that runs it, and a wire
 * that carried it would invite two harnesses to disagree about the same model.
 *
 * `1.3.0` adds **remote control**: a `remoteControl` capability and a `remote-control` message that
 * re-aims an open session. ⛔ The bridge itself stays in the harness, not in Studio — claude.ai/code is
 * Anthropic's, and a Studio that opened it would be core keeping vendor code for exactly the reason
 * this seam exists to remove. The protocol carries the *mode*; what a harness does with it is its own.
 *
 * `1.2.0` completes the **turn envelope**. `AgentRunContext` carries 29 fields and the envelope carried
 * 16, so a harness could not see the permission posture, the tool policies, attached images or context,
 * the remote-control mode, the agent shell, or the owning tab. Nine fields closes that, which is what
 * makes an out-of-process harness able to reach parity with an in-core provider at all — until now the
 * ceiling was the wire, not the port.
 */
export const AGENT_PROTOCOL_VERSION: string = '1.4.0';

/**
 * Matches a plain three-part semver. Local and deliberately strict, for the same reason the manifest's
 * is: this module is imported by both compilations and stays free of dependencies.
 */
const VERSION_PATTERN: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * The blocking questions a harness can ask Studio mid-turn.
 *
 * Each has a matching {@link HarnessAnswer}, correlated by `callId`. Four of the five are the reason
 * this is a protocol rather than a stream: the harness stops and waits, and what it waits for is a
 * person. `credential` is the exception — Studio answers it from what the user configured earlier, and
 * asking again per turn would be absurd.
 */
export type HarnessRequestKind = 'permission' | 'input' | 'edit-decision' | 'bridge' | 'credential';

/**
 * How a harness maintains a conversation, declared at handshake.
 *
 * Mirrors `AgentSessionModel`: `live-harness` keeps a session open across turns and can be resumed;
 * `stateless` treats every turn as a fresh call with the transcript replayed.
 */
export type HarnessSessionModel = 'live-harness' | 'stateless';

/**
 * What a harness says it can do, at handshake.
 *
 * Declared rather than assumed, and declared **once** rather than probed per turn. A capability absent
 * here means Studio does not offer the corresponding affordance at all — which is the honest outcome,
 * and better than offering one that silently does nothing.
 */
export interface HarnessCapabilities {
  /**
   * Gets the protocol version the harness was written against.
   */
  readonly protocolVersion: string;

  /**
   * Gets how the harness maintains a conversation.
   */
  readonly sessionModel: HarnessSessionModel;

  /**
   * Gets whether the harness accepts a user message injected mid-turn. When false, Studio queues a
   * steering message for the next turn instead, exactly as it does today for a provider that registers
   * no steer handler.
   */
  readonly steering: boolean;

  /**
   * Gets whether the harness accepts images in a turn's input.
   */
  readonly images: boolean;

  /**
   * Gets the reasoning-effort levels the harness understands, in ascending order. Empty when it has no
   * notion of effort, in which case Studio does not offer the control.
   */
  readonly efforts: readonly string[];

  /**
   * Gets whether the harness can resume a previous session by id, and fork one. Meaningless for a
   * `stateless` harness and ignored there.
   */
  readonly resumable: boolean;

  /**
   * Gets whether the harness can expose its session to another machine.
   *
   * ⚠️ Confirms what the manifest already declared, because the control is offered in the ribbon before
   * anything has been started. A harness that contradicts its manifest here is **warned about rather
   * than refused**, unlike a session-model mismatch: the symptom is a toggle that does nothing, and
   * refusing the whole provider over it would be a worse outcome than the fault it reports.
   */
  readonly remoteControl: boolean;

  /**
   * Gets whether the harness can report the models it runs.
   *
   * ⛔ Load-bearing, not decorative. `discover` is a message the harness must answer, and a harness that
   * simply ignores one it has never heard of leaves Studio waiting on a reply that will never come —
   * a settings dialog stuck forever. Asking only a harness that said it can answer is what makes an
   * unimplemented message safe, and a harness speaking an older minor sends no flag at all, so it is
   * read as false and never asked.
   */
  readonly discovery: boolean;
}

/**
 * The turn envelope: everything a harness needs to run one turn, and nothing that cannot be sent.
 *
 * This is `AgentRunContext` with the live objects removed and the callbacks turned into messages. The
 * field names are kept identical on purpose — a reader holding both open should not have to translate.
 */
export interface TurnRequest {
  /**
   * Gets the identifier of the run, which every event and request for this turn carries back.
   */
  readonly requestId: string;

  /**
   * Gets the user's prompt.
   */
  readonly prompt: string;

  /**
   * Gets the absolute path of the workspace root, or null when no workspace is open.
   */
  readonly workspaceRoot: string | null;

  /**
   * Gets the model to run.
   */
  readonly model: string;

  /**
   * Gets the agent session this turn belongs to, or null for a one-off run.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the reasoning effort, or null to leave it to the harness.
   */
  readonly effort: string | null;

  /**
   * Gets whether the turn may write, or is read-only. `chat` is read-only; `agent` may act.
   */
  readonly mode: 'chat' | 'agent';

  /**
   * Gets the surface the turn was dispatched from, which some harnesses use to shape their prompt.
   */
  readonly surface: string;

  /**
   * Gets the paths the turn may write to. **A boundary, not a hint**: a harness that writes outside
   * this is misbehaving, and the host enforces it rather than trusting the harness to.
   */
  readonly allowedWritePaths: readonly string[];

  /**
   * Gets the paths the turn may not write to, which win over {@link allowedWritePaths}.
   */
  readonly deniedWritePaths: readonly string[];

  /**
   * Gets the network locations the turn may reach, empty for no restriction.
   */
  readonly allowedNetworkLocations: readonly string[];

  /**
   * Gets the network locations the turn may not reach, which win over the allowed list.
   */
  readonly deniedNetworkLocations: readonly string[];

  /**
   * Gets the token budget for the turn.
   */
  readonly tokenCap: number;

  /**
   * Gets the session to resume, or null to start a new one. Ignored by a `stateless` harness.
   */
  readonly resumeSessionId: string | null;

  /**
   * Gets whether resuming should fork the session rather than continue it.
   */
  readonly forkSession: boolean;

  /**
   * Gets the timestamp to resume the session from, or null to resume at its end.
   */
  readonly resumeSessionAt: string | null;

  /**
   * Gets how freely the turn may act without asking. `prompt` asks for everything, `auto-edits`
   * permits edits, `auto-all` permits everything.
   *
   * ⚠️ A posture is not a substitute for the permission round-trip — it decides how often the harness
   * needs to use it. A harness that reads this and then never asks is misbehaving, which is why the
   * host still refuses on abort rather than assuming a posture means nothing will be asked.
   */
  readonly permissionPosture: 'prompt' | 'auto-edits' | 'auto-all';

  /**
   * Gets the per-tool policy, keyed by tool name. A tool absent from the map has no policy of its own
   * and falls to {@link permissionPosture}.
   */
  readonly toolPolicies: Readonly<Record<string, 'allow' | 'ask' | 'deny'>>;

  /**
   * Gets the images attached to the turn's input. Empty when there are none, and always empty for a
   * harness that declared `images: false` at the handshake.
   */
  readonly images: readonly TurnImage[];

  /**
   * Gets the files and selections the user attached as context.
   */
  readonly contextPaths: readonly TurnContextRef[];

  /**
   * Gets whether the run may be driven from outside the app, and how far. `off` is the default and the
   * only value a harness that declared no remote-control support will ever see.
   */
  readonly remoteControl: 'off' | 'mirror' | 'control';

  /**
   * Gets the shell the turn's own command execution should use, or null to inherit the environment.
   */
  readonly agentShell: string | null;

  /**
   * Gets the editor tab that owns the run, so in-app tools act on that tab; null for the standalone
   * agent tab.
   */
  readonly owningTabId: string | null;

  /**
   * Gets the settings Studio holds on this plugin's behalf, whose meaning belongs to the plugin.
   *
   * ⛔ Opaque on purpose, on the same grounds as a `bridge` request's `input`: the protocol must not
   * name one vendor's concepts. The Claude harness's choice of CLI is a setting *it* understands, and a
   * field called `claudeExecutable` in a vendor-neutral wire would be the seam naming a vendor.
   *
   * ⚠️ A way station, not the destination. These values still originate as fields on Studio's own run
   * context, so core continues to know their names until plugins can declare their own settings. What
   * this buys now is that the *protocol* does not.
   */
  readonly providerSettings: Readonly<Record<string, unknown>>;
}

/**
 * An image attached to a turn's input.
 */
export interface TurnImage {
  /**
   * Gets the IANA media type.
   */
  readonly mediaType: string;

  /**
   * Gets the base64-encoded bytes.
   */
  readonly data: string;

  /**
   * Gets the display name, when one is known.
   */
  readonly name?: string;
}

/**
 * A file, folder or selection the user attached to a turn as context.
 */
export interface TurnContextRef {
  /**
   * Gets the absolute path.
   */
  readonly path: string;

  /**
   * Gets what was attached.
   */
  readonly kind: 'file' | 'folder' | 'selection';

  /**
   * Gets the attached content, when Studio resolved it rather than leaving the harness to read it.
   */
  readonly content?: string;
}

/**
 * A message Studio sends a harness.
 */
export type HostMessage =
  | { readonly type: 'initialize'; readonly protocolVersion: string }
  | { readonly type: 'turn.start'; readonly turn: TurnRequest }
  | { readonly type: 'turn.abort'; readonly requestId: string }
  | { readonly type: 'steer'; readonly requestId: string; readonly text: string }
  // Session-scoped rather than turn-scoped, and deliberately so: a user toggling remote control
  // expects it to land on the conversation they are looking at, including between turns and mid-turn.
  // An aim that only took effect at the start of a turn would leave the toggle dangling until the next
  // one, which for a held-open session could be never.
  | { readonly type: 'remote-control'; readonly mode: 'off' | 'mirror' | 'control' }
  // Answered with `models` under the same id. The id is a run id, so anything the harness has to ask
  // before it can answer travels the ordinary request path.
  | { readonly type: 'discover'; readonly discoveryId: string }
  | { readonly type: 'answer'; readonly callId: string; readonly answer: HarnessAnswer };

/**
 * The answer to a blocking request, carried back under the request's `callId`.
 *
 * ⚠️ Every one has a shape for "the user did not answer", because a turn can be aborted while a prompt
 * is open. A harness must handle a refusal for every question it asks.
 */
export type HarnessAnswer =
  | { readonly kind: 'permission'; readonly granted: boolean }
  | { readonly kind: 'input'; readonly answer: string | null }
  | { readonly kind: 'edit-decision'; readonly decision: 'yes' | 'no' }
  | { readonly kind: 'bridge'; readonly result: unknown; readonly error: string | null }
  | { readonly kind: 'credential'; readonly apiKey: string | null };

/**
 * A message a harness sends Studio.
 *
 * `event` carries `AiEvent` unchanged, which is the whole reason this protocol is tractable: the
 * streaming vocabulary is the one Studio already renders.
 */
export type HarnessMessage =
  | { readonly type: 'ready'; readonly capabilities: HarnessCapabilities }
  | { readonly type: 'event'; readonly event: AiEvent }
  | {
      readonly type: 'request';
      readonly callId: string;
      readonly requestId: string;
      readonly request: HarnessRequest;
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
    };

/**
 * A model a harness reports it can run.
 *
 * ⛔ Deliberately two fields. The context window is resolved in core from the id — it is a fact about a
 * model, not about the harness running it, and a wire that carried it would let two harnesses disagree
 * about the same model with nothing to arbitrate.
 */
export interface HarnessModel {
  /**
   * Gets the model identifier, as the harness would be asked to run it.
   */
  readonly id: string;

  /**
   * Gets the display name, or undefined to show the identifier.
   */
  readonly label?: string;
}

/**
 * The body of a blocking request from a harness.
 */
export type HarnessRequest =
  | { readonly kind: 'permission'; readonly name: string; readonly detail: string }
  | { readonly kind: 'input'; readonly question: string; readonly choices: readonly string[] }
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
  // Carries no fields: the turn already says which connection it belongs to, and there is exactly one
  // secret a connection has. A harness naming the credential it wants would be a harness able to ask
  // for somebody else's.
  | { readonly kind: 'credential' };

/**
 * Gets whether a harness's declared protocol version is one this build can honour.
 *
 * Same rule as the plugin manifest, and for the same reason: a different major is a different contract;
 * a newer minor may use messages this build would ignore, and an agent turn that quietly does less is
 * worse than one that refuses to start; an older minor is fine, since every version only adds.
 * @param declared The version the harness declares.
 * @param supported The version this build implements, defaulting to {@link AGENT_PROTOCOL_VERSION}.
 * @returns Returns true when the harness can be hosted.
 */
export function isProtocolCompatible(
  declared: string,
  supported: string = AGENT_PROTOCOL_VERSION,
): boolean {
  const left: RegExpExecArray | null = VERSION_PATTERN.exec(declared);
  const right: RegExpExecArray | null = VERSION_PATTERN.exec(supported);
  if (left === null || right === null) {
    return false;
  }
  if (left[1] !== right[1]) {
    return false;
  }
  const declaredMinor: number = Number(left[2]);
  const supportedMinor: number = Number(right[2]);
  if (declaredMinor !== supportedMinor) {
    return declaredMinor < supportedMinor;
  }
  return Number(left[3]) <= Number(right[3]);
}

/**
 * The message types a harness may send, as a closed set the validator checks against.
 */
const HARNESS_MESSAGE_TYPES: readonly string[] = [
  'ready',
  'event',
  'request',
  'audit',
  'turn.completed',
  'turn.failed',
  'models',
];

/**
 * Validates a message arriving from a harness.
 *
 * **Refuses rather than repairs.** A harness is another program — possibly one Studio downloaded — so a
 * message that is not the shape this protocol describes is not guessed at. The alternative is a
 * malformed request reaching the permission prompt, which is the one place in Studio where believing a
 * badly-formed thing has consequences.
 *
 * Deliberately shallow: it checks the envelope and the discriminants, not the whole payload. `AiEvent`
 * is validated where it is consumed, and a `bridge` request's `input` is `unknown` by design — its
 * shape belongs to the capability being invoked, not to this protocol.
 * @param value The parsed JSON to validate.
 * @returns Returns the message, or null when it is not one.
 */
export function parseHarnessMessage(value: unknown): HarnessMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate: { type?: unknown; callId?: unknown; requestId?: unknown } = value;
  if (typeof candidate.type !== 'string' || !HARNESS_MESSAGE_TYPES.includes(candidate.type)) {
    return null;
  }
  // A request is the only message whose correlation id Studio must answer under, so a missing one is
  // not recoverable: nothing could route the reply back.
  if (candidate.type === 'request' && typeof candidate.callId !== 'string') {
    return null;
  }
  // Everything that belongs to a turn must say which turn. An event for no run cannot be rendered, a
  // settle for no run would resolve nothing, and an audit record for no run names an executed action
  // without saying what executed it — which is the one thing an audit log exists to answer.
  const needsRequestId: readonly string[] = ['request', 'audit', 'turn.completed', 'turn.failed'];
  if (needsRequestId.includes(candidate.type) && typeof candidate.requestId !== 'string') {
    return null;
  }
  return value as HarnessMessage;
}
