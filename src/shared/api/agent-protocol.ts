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
// | `setSteerHandler` | Registers a callback | `steer` in `capabilities.answers`, plus `steer` messages |
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
 *
 * `1.2.0` completes the **turn envelope**. `AgentRunContext` carries 29 fields and the envelope carried
 * 16, so a harness could not see the permission posture, the tool policies, attached images or context,
 * the remote-control mode, the agent shell, or the owning tab. Nine fields closes that, which is what
 * makes an out-of-process harness able to reach parity with an in-core provider at all — until now the
 * ceiling was the wire, not the port.
 *
 * `1.3.0` adds **remote control**: a `remoteControl` capability and a `remote-control` message that
 * re-aims an open session. ⛔ The bridge itself stays in the harness, not in Studio — claude.ai/code is
 * Anthropic's, and a Studio that opened it would be core keeping vendor code for exactly the reason
 * this seam exists to remove. The protocol carries the *mode*; what a harness does with it is its own.
 *
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
 *
 * `1.5.0` replaces the per-feature capability flags with a single `answers` list: the host messages a
 * harness will reply to, with Studio refusing to send anything else. `steering`, `discovery` and the
 * handshake half of `remoteControl` all became entries in it. ⛔ Three flags in four versions, each
 * added because a message that goes unanswered **hangs** rather than fails, was a pattern rather than a
 * coincidence — and the third was caught only because a bug had already been written. A harness on an
 * older minor sends no list, which is read as "answers only the mandatory four", so every published
 * plugin keeps working and simply is not offered the optional messages.
 *
 *
 * `1.6.0` adds **Studio's own tools**: a `tools` request for their descriptions and a `tool` request to
 * run one. A harness whose model brings its own tools — Claude's and Codex's SDKs both do — never asks.
 * One that talks to a plain model API has none of its own, so Studio must supply them, and that is what
 * makes Ollama and every OpenAI-compatible endpoint reachable as a plugin.
 *
 * ⛔ Descriptions cross the wire; **execution never does**. The harness is told a tool exists and what
 * it takes, and asks Studio to run it — so the tool's implementation, its permission gate and its audit
 * record all stay on Studio's side of the seam, which is where the user's permissions are enforced.
 *
 * ⛔ A tool the user has set to Deny is **omitted from the list entirely** rather than sent and refused.
 * The model is never told it exists. The accepted cost, recorded here because it is a real one: a model
 * that cannot see a capability may work around it or fail without explaining itself, where one told
 * "that is switched off" could have said so.
 *
 * ⚠️ Neither request is gated by `answers`, and that is not an oversight: both travel *from* the harness,
 * so a harness that does not implement them simply never asks. The hang that `answers` prevents is only
 * possible for messages going the other way.
 * `1.7.0` adds the **system prompt** to the `tools` answer. It was the other half of the same thing:
 * Studio's per-surface instructions describe the very tools that answer already carries — how to use
 * them, when to ask the user instead of guessing, and that a chat turn may not act. A harness given the
 * tools but not the instructions would have had to invent its own, and two descriptions of one set of
 * capabilities drift in exactly the way #653 exists to prevent.
 *
 * ⛔ Sent together rather than as a second request. They are never wanted apart, and splitting them
 * would be two round-trips for one question.
 *
 *
 * `1.8.0` moves the provider settings onto `initialize`, so a harness knows **which connection it
 * serves before it says what it can do**. They were turn-scoped, and two things a harness is asked
 * happen outside a turn:
 *
 *   - the **handshake**. `images` is declared once, and for a harness talking to a plain model API
 *     whether images are accepted is a fact about the connection's provider, not about the harness. One
 *     that has not been told which provider it serves can only guess, and either guess is wrong for
 *     half the connections.
 *   - **discovery**. `discover` carries no envelope, so a harness asked what it can run had nothing
 *     saying which endpoint to ask. For an OpenAI-compatible connection that is the entire question.
 *
 * ⛔ Still not a secret, and still not vendor-named. The bag is the same opaque
 * {@link TurnRequest.providerSettings} — the endpoint and the provider kind a *user* configured, which
 * a harness could have been handed at spawn time just as well. The credential round-trip is unchanged
 * and remains the only way a harness obtains one.
 *
 * ⚠️ `turn.start` keeps carrying them. They are merged per turn and a turn-level value is the one that
 * applies, so nothing that already reads them there has to change.
 *
 * It also lets a `models` answer say **why** it is empty. 1.4.0 gave a harness a way to report models
 * and no way to report the reason it could not, so every failure — an unreachable local server, a
 * missing key, a gateway answering 403 — arrived in Settings as the same sentence: "reported no models.
 * Add models manually." The in-core discovery it replaces distinguishes all three by name, and losing
 * that would have been the port costing a user something.
 *
 * ⛔ Advisory, and only used when the list is empty. A harness that reports models *and* a complaint is
 * reporting models; core phrases the success, because how a discovery reads in Settings is one decision
 * made in one place.
 *
 *
 * `1.9.0` is the version the **Claude port** needed, and every addition in it is a capability the
 * in-core provider had that the wire could not carry. None is speculative: each one was found by
 * putting `ClaudeAgentProvider` beside {@link HostMessage} and asking what would be lost.
 *
 *   - **`task.stop`** and **`panic`**, so a `live-harness` can honour `AgentSession.stopTask` and
 *     `AgentSession.panicStop`. A harness that runs work in the background — Claude's SDK backgrounds a
 *     shell command or a sub-agent — owns the only registry of what is running, so Studio cannot stop a
 *     task by naming one it does not know about. ⚠️ `panic` is a *request*: the host still escalates to
 *     closing the transport if the harness does not settle, because the user's Stop is a promise that
 *     everything halts rather than a polite enquiry.
 *   - **`cancel`**, the first message that travels *from* a harness to withdraw something. A harness
 *     that raced Studio's prompt against another answerer — the Claude harness races claude.ai/code
 *     under remote control — had no way to say the question had been answered elsewhere, so Studio's
 *     prompt stayed open over a turn that had already moved on. It carries a `callId` and nothing else.
 *   - **`choices` on an `input` request gains a description per choice.** `AiInputChoice` has carried
 *     one since the input round-trip existed and the wire flattened it to a label, so a harness could
 *     offer the options but not explain them — which is most of what makes a choice answerable.
 *     ⚠️ A bare string is still accepted and read as a label, so every published harness is unaffected.
 *   - **`omit` on a `tools` request**, for a harness whose model already brings one of Studio's tools.
 *     Claude's SDK has its own clarifying-question tool, and being handed Studio's as well gives the
 *     model two ways to ask, described differently. A harness names what it already has; core drops
 *     those and — because the instructions describe the tools — phrases the prompt for what is left.
 */
export const AGENT_PROTOCOL_VERSION: string = '1.9.0';

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
   * Gets the host messages the harness answers.
   *
   * ⛔ **One list rather than a flag per feature**, and the reason is a failure that had already
   * happened twice by the time this replaced them. Several host messages are ones the harness *must*
   * reply to — `discover` most obviously — and a harness that silently ignores a message it has never
   * heard of leaves Studio awaiting a reply that never comes. Not a feature that fails: a settings
   * dialog or a turn that hangs. Guarding each new message with its own boolean worked, but only for as
   * long as whoever added the next message remembered to add the next boolean.
   *
   * Studio refuses to send anything absent from this list, so an unimplemented message is not merely
   * unanswered — it is never sent, and the caller gets an immediate "cannot" instead of a wait.
   *
   * ⚠️ Four messages are **never** gated, because a harness that cannot handle them is not a harness:
   * `initialize`, `turn.start`, `turn.abort` and `answer`.
   *
   * 🔑 This subsumes what used to be `steering`, `discovery`, and the handshake half of `remoteControl`.
   * What remains below is genuinely different in kind: those describe what Studio should **offer the
   * user**, not what the harness will reply to.
   */
  readonly answers: readonly string[];

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
  // Carries the settings from 1.8.0, because what a harness can do may depend on which connection it
  // serves — and the handshake is the first thing that asks.
  | {
      readonly type: 'initialize';
      readonly protocolVersion: string;
      readonly settings: Readonly<Record<string, unknown>>;
    }
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
  // Session-scoped like `remote-control`, and for a sharper version of the same reason: a background
  // task outlives the turn that launched it, so the run id it started under may long since have
  // settled. The harness owns the registry of what is running; Studio only names one.
  | { readonly type: 'task.stop'; readonly taskId: string }
  // The user's Stop, escalated: stop the background work, interrupt whatever is in flight — including a
  // turn nothing is awaiting, which a per-turn `turn.abort` cannot reach because no run holds it.
  //
  // ⚠️ A request, not a guarantee. The host gives the harness a grace period to settle and then closes
  // the transport regardless, because a wedged harness is precisely what a panic stop is for.
  | { readonly type: 'panic' }
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
  | { readonly kind: 'credential'; readonly apiKey: string | null }
  | {
      readonly kind: 'tools';
      readonly tools: readonly HarnessTool[];
      // Studio's instructions for the turn's surface and mode: what this surface is, how to use the
      // tools above, and — in a chat turn — that it may read but not act. Carried with the tools
      // because it describes them; a harness that had to write its own would be a second description
      // of one set of capabilities, drifting from the first.
      readonly systemPrompt: string;
    }
  | { readonly kind: 'tool'; readonly result: string | null; readonly error: string | null };

/**
 * One of Studio's own tools, as described to a harness.
 *
 * ⛔ No implementation crosses. The harness learns that a tool exists and what it takes; running it is a
 * `tool` request back to Studio, so the permission gate and the audit record stay where the user's
 * settings are enforced.
 */
export interface HarnessTool {
  /**
   * Gets the tool's name, which is what a `tool` request names to run it.
   */
  readonly name: string;

  /**
   * Gets the description shown to the model.
   */
  readonly description: string;

  /**
   * Gets the input shape, as JSON Schema.
   *
   * Converted from the schema Studio holds rather than authored twice — the two drifting apart would
   * mean a model calling a tool with arguments Studio then rejects.
   */
  readonly inputSchema: unknown;
}

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
  // Withdraws a question the harness no longer needs answered (1.9.0). The only message that travels
  // this way to *un*-ask something, and it exists because a harness can race Studio's prompt against
  // another answerer: the Claude harness forwards a permission to claude.ai/code under remote control,
  // and whichever side answers first should clear the other's prompt.
  //
  // ⚠️ Studio treats this as "the user did not answer", not as a denial. The harness got its answer
  // from somewhere else; what it is saying here is only that this prompt is no longer needed.
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
      // Why the list is empty, when the harness knows (1.8.0). Read only when `models` is empty: a
      // harness that reported models is reporting models, and core phrases the success.
      readonly detail?: string;
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
  | {
      readonly kind: 'input';
      readonly question: string;
      readonly choices: readonly HarnessChoice[];
    }
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
  | { readonly kind: 'credential' }
  // Asked by a harness whose model has no tools of its own. What comes back depends on the turn's
  // surface and mode, so it is asked per turn rather than cached across a session.
  | {
      readonly kind: 'tools';
      // The tools the harness already has, which core leaves out of the answer (1.9.0). A harness
      // whose model brings its own version of one of Studio's tools would otherwise be given two ways
      // to do the same thing, described differently — and a model handed both picks either.
      //
      // ⛔ Names what the harness *has*, not what it wants withheld. That distinction decides how core
      // phrases the instructions: a capability the harness provides itself is still described to the
      // model, just without naming a Studio tool to reach it by.
      readonly omit?: readonly string[];
    }
  | { readonly kind: 'tool'; readonly name: string; readonly input: unknown };

/**
 * One suggested answer to an `input` request.
 *
 * ⚠️ A harness may send a bare string instead, which is read as a label with no description. That is
 * what keeps every harness published against 1.8.0 and earlier working — the wire carried only labels
 * until 1.9.0, and a shape that refused them would break the ones already installed.
 */
export interface HarnessChoice {
  /**
   * Gets the short answer label, which is what comes back verbatim when the user picks it.
   */
  readonly label: string;

  /**
   * Gets the explanation of what picking this choice means, or undefined when the label speaks for
   * itself.
   */
  readonly description?: string;
}

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
  'cancel',
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
  // not recoverable: nothing could route the reply back. A cancel names the same id from the other
  // direction, and one that named nothing could only be read as "withdraw something", which is worse
  // than being refused — it would dismiss a prompt the user is part way through answering.
  if (
    (candidate.type === 'request' || candidate.type === 'cancel') &&
    typeof candidate.callId !== 'string'
  ) {
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
