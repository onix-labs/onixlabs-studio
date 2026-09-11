#!/usr/bin/env node
// The AI SDK agent harness: Vercel's AI SDK, driven in its own process, speaking Studio's agent
// protocol (#653).
//
// The harness that was supposed to be impossible. `AiSdkAdapter` was written down as an explicit
// **non-goal** of this epic — "it talks HTTP, there is no subprocess seam to move it through" — and that
// was wrong. The protocol is a turn-and-event contract; it has no opinion about what a harness does to
// produce the events, and "spawns a CLI" was never part of the definition. Retracting that is what makes
// the acceptance criterion reachable: a freshly built Studio with no provider plugin installed has no
// working agents, and *every* provider is something the user chose.
//
// It is also the harness that carries the most. Claude and Codex bring their own tools; this one talks
// to a plain model API and has none, so everything Studio can do — twenty-eight tools across five
// surfaces — has to reach the model from somewhere.
//
// ## ⛔ The tools stay in core, and only their descriptions cross
//
// This harness asks Studio for them (`kind: 'tools'`, protocol 1.6.0) and gets back their names,
// descriptions and JSON Schemas, plus the surface's own instructions (1.7.0). When the model calls one,
// the harness asks Studio to **run** it (`kind: 'tool'`).
//
// That is not a shortcut, it is the design. The tool's implementation, its permission gate and its audit
// record all stay on Studio's side of the seam — which is where the user's settings are, and the only
// place enforcing them means anything. A plugin cannot grant itself a capability by describing one, and
// a twenty-ninth tool is one change in core rather than a republish of every plugin that wants it.
//
// It also halved this file. The alternative — reproducing `ai-sdk-stream.ts`'s tool definitions here —
// would have been seven hundred lines of Zod schemas kept in sync by hand with the ones Studio holds,
// and two descriptions of one set of capabilities drift in exactly the way #653 exists to prevent.
//
// ## What this harness *is* responsible for
//
// Building the client (four `@ai-sdk/*` families, selected by the connection's kind), resolving where it
// points, translating `fullStream` into Studio's transcript events, and answering `discover` — which is
// the part no in-core provider could do for a plugin, because the old path read the connection's *auth
// kind* to decide which vendor to ask.

import { createInterface } from 'node:readline';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, stepCountIs, streamText, tool } from 'ai';
import type { ImagePart, LanguageModel, ModelMessage, ToolSet } from 'ai';
import { discoverModels, type DiscoveryReport } from './discovery';
import {
  clientFamily,
  kindSupportsImages,
  resolveEndpoint,
  usesLocalToolAppendix,
  type ResolvedEndpoint,
} from './endpoint';
import { describeRunError, mapStreamPart, type StreamPart } from './events';
import {
  type Answer,
  type HarnessMessage,
  type HarnessTool,
  type HostMessage,
  PROTOCOL_VERSION,
  type ProviderSettings,
  readProviderSettings,
  type Request,
  type TurnRequest,
} from './protocol';

/**
 * The maximum number of steps — model turns plus tool round-trips — one run may take before the AI SDK
 * stops the agentic loop.
 */
const MAX_STEPS: number = 16;

/**
 * Appended to the system prompt for local, open-weight models (Ollama and self-hosted OpenAI-compatible
 * endpoints).
 *
 * Small local models reliably narrate what they "would" do instead of calling their function tools, so
 * this spells the contract out bluntly. The hosted providers do not need it — Studio's own surface
 * instructions already name the tools — and adding it for them would be a paragraph of shouting in a
 * prompt that is already long.
 *
 * ⚠️ This stays in the harness rather than coming from Studio with the rest of the prompt, and the split
 * is deliberate: Studio describes *its tools*, which is the same on every connection; this describes how
 * a particular family of models behaves, which is the harness's business.
 */
const LOCAL_TOOL_USE_APPENDIX: string = [
  'IMPORTANT: You have real function-calling tools, and they are your ONLY way to act. Never',
  'describe, promise, or print a command, edit, or answer that a tool should produce — CALL THE',
  'TOOL instead, immediately, without asking for permission first (the app handles permissions and',
  'will ask the user for you). For terminal work: call write_terminal_input with the command, then',
  'call read_terminal_output to see the result. For document or binary work: call the matching',
  'read tool before answering and the matching write tool to change anything. Replying in prose',
  'when a tool applies is a failure. Act first, then summarise briefly what happened.',
].join('\n');

/**
 * Writes one protocol message to Studio.
 * @param message The message to send.
 */
function send(message: HarnessMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Emits one of Studio's own transcript events.
 * @param event The event, shaped as Studio's `AiEvent`.
 */
function emit(event: Record<string, unknown>): void {
  send({ type: 'event', event });
}

/**
 * Writes a diagnostic to stderr, which Studio drains into its log.
 *
 * ⛔ Never stdout. That pipe carries the protocol, and a warning written to it is a line Studio tries to
 * parse as a message — the failure #541 was, arriving from the other direction.
 * @param note What happened.
 */
function trace(note: string): void {
  process.stderr.write(`${note}\n`);
}

/**
 * Holds the answers Studio owes this harness, by call id.
 */
const awaiting: Map<string, (answer: Answer) => void> = new Map<string, (answer: Answer) => void>();

/**
 * Counts questions asked, so each gets its own correlation id.
 */
let calls: number = 0;

/**
 * Holds what Studio said about the connection this harness serves, from the handshake.
 *
 * 🔑 Known before the first turn, which is what protocol 1.8.0 added it for: whether this connection
 * accepts images is declared once at the handshake, and `discover` arrives with no turn envelope at all.
 */
let settings: ProviderSettings = readProviderSettings(undefined);

/**
 * Holds the turns in flight, so an abort knows what to cancel.
 *
 * A map rather than a single slot even though this harness is `stateless` and takes one turn per
 * process: an abort names a run, and a refusal to act on an id that is not the one in hand is cheaper
 * than discovering later that "the current turn" was the wrong one.
 */
const running: Map<string, AbortController> = new Map<string, AbortController>();

/**
 * Asks Studio a blocking question and resolves with its answer.
 * @param requestId The run the question belongs to.
 * @param request The question.
 * @returns Returns the answer.
 */
function ask(requestId: string, request: Request): Promise<Answer> {
  calls += 1;
  const callId: string = `call-${calls}`;
  return new Promise<Answer>((resolve): void => {
    awaiting.set(callId, resolve);
    send({ type: 'request', callId, requestId, request });
  });
}

/**
 * Asks Studio for the connection's API key.
 *
 * ⛔ Asked at the point of use rather than handed over in the turn envelope, which is what the credential
 * round-trip exists for: a key that never rides the wire cannot end up in a log the day somebody adds a
 * trace to the protocol.
 * @param requestId The run asking.
 * @returns Returns the key, or null when there is none or the user did not answer.
 */
async function credentialFor(requestId: string): Promise<string | null> {
  const answer: Answer = await ask(requestId, { kind: 'credential' });
  return answer.kind === 'credential' ? answer.apiKey : null;
}

/**
 * Assembles the prompt Studio's own providers assemble, from the envelope's context attachments.
 *
 * ⚠️ Reproduced rather than imported. It is 24 lines of string assembly over fields the envelope already
 * carries, and a harness that shares code with Studio is a harness that cannot be extracted — which is
 * the property this whole exercise is protecting. Kept identical so an attached file reads the same
 * whichever provider runs it.
 * @param turn The turn envelope.
 * @returns Returns the assembled prompt.
 */
function promptFor(turn: TurnRequest): string {
  const sections: string[] = [];
  const paths: readonly { path: string; kind: string }[] = turn.contextPaths.filter(
    (reference: { kind: string }): boolean => reference.kind !== 'selection',
  );
  if (paths.length > 0) {
    const lines: string = paths
      .map(
        (reference: { path: string; kind: string }): string =>
          ` - ${reference.path} (${reference.kind})`,
      )
      .join('\n');
    sections.push(
      'The user attached the following context. Read the files and explore the folders with your ' +
        `file tools (Read, Glob, Grep) as needed to answer:\n${lines}`,
    );
  }
  for (const reference of turn.contextPaths) {
    if (
      reference.kind === 'selection' &&
      typeof reference.content === 'string' &&
      reference.content.length > 0
    ) {
      sections.push(
        `The user attached this editor selection (${reference.path}):\n"""\n${reference.content}\n"""`,
      );
    }
  }
  sections.push(turn.prompt);
  return sections.join('\n\n');
}

/**
 * Builds the AI SDK language model for a turn.
 *
 * The one place the connection's *kind* decides anything, and the reason it is here rather than in core:
 * choosing between four client families by vendor is exactly the branch #653 exists to move out.
 * @param turn The turn envelope.
 * @param apiKey The connection's key, or null when it has none.
 * @returns Returns the language model.
 */
function createModel(turn: TurnRequest, apiKey: string | null): LanguageModel {
  const endpoint: ResolvedEndpoint = resolveEndpoint(
    settings.connectionKind,
    settings.baseUrl,
    process.env,
  );
  const key: string = apiKey ?? '';
  const baseUrlOption: { baseURL: string } | Record<string, never> =
    endpoint.baseUrl !== undefined ? { baseURL: endpoint.baseUrl } : {};

  switch (clientFamily(settings.connectionKind)) {
    case 'anthropic':
      return createAnthropic({ apiKey: key, ...baseUrlOption })(turn.model);
    case 'openai':
      return createOpenAI({ apiKey: key, ...baseUrlOption })(turn.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: key, ...baseUrlOption })(turn.model);
    default: {
      if (endpoint.baseUrl === undefined) {
        throw new Error(
          `The connection "${settings.connectionLabel}" needs a base URL before it can run.`,
        );
      }
      return createOpenAICompatible({
        name: endpoint.name,
        baseURL: endpoint.baseUrl,
        // The OpenAI-compatible client expects a non-empty key even when the server ignores it.
        apiKey: key.length > 0 ? key : 'unused',
        ...(Object.keys(settings.headers).length > 0 ? { headers: settings.headers } : {}),
      })(turn.model);
    }
  }
}

/**
 * Turns the tools Studio described into ones the model can call.
 *
 * ⛔ Every executor is a round-trip back to Studio. Nothing here runs anything: the schema says what the
 * tool takes, and Studio — which holds the implementation, the permission gate and the audit log — is
 * what decides whether it happens.
 *
 * ⚠️ A failure is **thrown**, not returned. The AI SDK turns a thrown executor into a `tool-error` part,
 * which becomes a failed tool in the transcript; returning the message as a result would show the model
 * a red action as a successful one. A *refusal* is different and arrives as an ordinary result, because
 * Studio's own gate returns "the user declined to run this tool" as the tool's answer — the model is
 * meant to read it and carry on.
 * @param described What Studio said it offers.
 * @param requestId The run the tools belong to.
 * @returns Returns the tool set.
 */
function toolSetFrom(described: readonly HarnessTool[], requestId: string): ToolSet {
  const set: Record<string, unknown> = {};
  for (const offered of described) {
    set[offered.name] = tool({
      description: offered.description,
      // Studio converts its own Zod schemas to JSON Schema before sending them, so nothing is authored
      // twice and the two cannot drift into a model calling a tool with arguments Studio then rejects.
      inputSchema: jsonSchema(offered.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input: unknown): Promise<string> => {
        const answer: Answer = await ask(requestId, {
          kind: 'tool',
          name: offered.name,
          input,
        });
        if (answer.kind !== 'tool') {
          throw new Error(`Studio did not answer the ${offered.name} tool.`);
        }
        if (answer.error !== null) {
          throw new Error(answer.error);
        }
        return answer.result ?? '';
      },
    });
  }
  return set as ToolSet;
}

/**
 * Builds the input for a turn: a plain prompt, or message parts when images are attached.
 * @param turn The turn envelope.
 * @param prompt The assembled prompt.
 * @returns Returns the input to hand the SDK.
 */
function inputFor(
  turn: TurnRequest,
  prompt: string,
): { prompt: string } | { messages: ModelMessage[] } {
  if (turn.images.length === 0) {
    return { prompt };
  }
  return {
    messages: [
      {
        role: 'user',
        content: [
          ...turn.images.map((image: { mediaType: string; data: string }): ImagePart => ({
            type: 'image',
            image: image.data,
            mediaType: image.mediaType,
          })),
          { type: 'text', text: prompt },
        ],
      },
    ],
  };
}

/**
 * Builds an actionable failure message for a run error, with a local-server hint for Ollama.
 * @param turn The turn envelope.
 * @param error The error the run threw.
 * @returns Returns the failure message.
 */
function describeFailure(turn: TurnRequest, error: unknown): string {
  if (settings.connectionKind === 'ollama') {
    const endpoint: ResolvedEndpoint = resolveEndpoint(
      settings.connectionKind,
      settings.baseUrl,
      process.env,
    );
    return (
      `Could not run "${turn.model}" on your local Ollama server at ${endpoint.baseUrl}. ` +
      `${describeRunError(error)}. Check that Ollama is running and that the model has been ` +
      `pulled — run: ollama pull ${turn.model}`
    );
  }
  return `The connection "${settings.connectionLabel}" could not run "${turn.model}". ${describeRunError(error)}.`;
}

/**
 * Runs one turn.
 * @param turn The turn envelope.
 */
async function runTurn(turn: TurnRequest): Promise<void> {
  const controller: AbortController = new AbortController();
  running.set(turn.requestId, controller);
  // A turn-level setting wins over the handshake's: the envelope is the more specific statement, and
  // nothing else could describe a connection edited while a session was open.
  settings = readProviderSettings({ ...settings, ...turn.providerSettings });
  try {
    // What Studio offers this turn: its tools, and the instructions that describe them. Asked per turn
    // rather than once per process, because what is offered depends on the turn's surface and mode — a
    // chat turn may read and not act, and the read-only set is a different set.
    const answer: Answer = await ask(turn.requestId, { kind: 'tools' });
    const offer: { tools: readonly HarnessTool[]; systemPrompt: string } =
      answer.kind === 'tools' ? answer : { tools: [], systemPrompt: '' };
    const tools: ToolSet = toolSetFrom(offer.tools, turn.requestId);
    const system: string = usesLocalToolAppendix(settings.connectionKind)
      ? `${offer.systemPrompt}\n\n${LOCAL_TOOL_USE_APPENDIX}`
      : offer.systemPrompt;

    const model: LanguageModel = createModel(turn, await credentialFor(turn.requestId));
    const stream: AsyncIterable<StreamPart> = streamText({
      model,
      system,
      ...inputFor(turn, promptFor(turn)),
      abortSignal: controller.signal,
      stopWhen: stepCountIs(MAX_STEPS),
      // Cap the output tokens when the user set a per-request budget; 0 leaves the model default.
      ...(turn.tokenCap > 0 ? { maxOutputTokens: turn.tokenCap } : {}),
      tools,
    }).fullStream as AsyncIterable<StreamPart>;

    for await (const part of stream) {
      if (controller.signal.aborted) {
        break;
      }
      // ⛔ An `error` part is thrown rather than mapped. The SDK reports request and stream failures —
      // an unreachable server, an unknown model, a refused connection — as a *part* rather than an
      // exception, so a harness that only mapped parts would end a failed run looking successful.
      if (part.type === 'error') {
        throw new Error(describeRunError(part.error));
      }
      mapStreamPart(part, turn.requestId, emit);
    }
    send({ type: 'turn.completed', requestId: turn.requestId, sessionId: null });
  } catch (error: unknown) {
    // An aborted turn is not a failure: Studio already knows it stopped the run, and reporting it as an
    // error would land a stopped turn in the transcript as a red one.
    if (controller.signal.aborted) {
      send({ type: 'turn.completed', requestId: turn.requestId, sessionId: null });
    } else {
      send({ type: 'turn.failed', requestId: turn.requestId, error: describeFailure(turn, error) });
    }
  } finally {
    running.delete(turn.requestId);
    awaiting.clear();
  }
}

/**
 * Answers Studio's question about what this connection can run.
 * @param discoveryId The id to answer under, which is a run id like any other.
 */
async function runDiscovery(discoveryId: string): Promise<void> {
  // A key is asked for under the discovery id, exactly as it would be mid-turn — which is why discovery
  // reuses the turn machinery rather than having a correlation space of its own.
  const apiKey: string | null =
    settings.connectionAuth === 'none' ? null : await credentialFor(discoveryId);
  const report: DiscoveryReport = await discoverModels(settings, apiKey, process.env);
  if (report.detail !== null) {
    trace(`discovery: ${report.detail}`);
  }
  send({
    type: 'models',
    discoveryId,
    models: report.models,
    ...(report.detail === null ? {} : { detail: report.detail }),
  });
}

/**
 * Handles one message from Studio.
 * @param message The message.
 */
function receive(message: HostMessage): void {
  switch (message.type) {
    case 'initialize':
      settings = readProviderSettings(message.settings);
      send({
        type: 'ready',
        capabilities: {
          protocolVersion: PROTOCOL_VERSION,
          // ⛔ Must match the manifest, or Studio refuses the harness. Stateless is the truth here and
          // not a limitation worked around: one `streamText` call is one turn, and the conversation is
          // Studio's to replay.
          sessionModel: 'stateless',
          // The one optional message this answers. Steering would need a call that accepts input while
          // it is running, and remote control is a session exposed outward, which a stateless HTTP turn
          // has nothing to expose.
          answers: ['discover'],
          // 🔑 Answerable only because 1.8.0 sends the settings with the handshake. A harness that did
          // not know which provider it serves would have to claim images for every connection or none,
          // and both are wrong for half of them.
          images: kindSupportsImages(settings.connectionKind),
          // No reasoning-effort control on this path, so Studio hides `/effort` rather than offering a
          // control that goes nowhere.
          efforts: [],
          resumable: false,
        },
      });
      break;
    case 'turn.start':
      void runTurn(message.turn);
      break;
    case 'discover':
      void runDiscovery(message.discoveryId);
      break;
    case 'answer': {
      const resolve: ((answer: Answer) => void) | undefined = awaiting.get(message.callId);
      awaiting.delete(message.callId);
      resolve?.(message.answer);
      break;
    }
    case 'turn.abort':
      running.get(message.requestId)?.abort();
      break;
    case 'steer':
    case 'remote-control':
      // Neither is listed in `answers`, so Studio never sends them — a steer is queued for the next turn
      // and remote control is never aimed here. Reaching this would be Studio ignoring the handshake,
      // which is worth neither crashing over nor acting on.
      break;
  }
}

const lines: ReturnType<typeof createInterface> = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
lines.on('line', (line: string): void => {
  try {
    receive(JSON.parse(line) as HostMessage);
  } catch {
    // Not JSON, so not a message. Studio never sends one; ignoring beats dying.
  }
});
// End of input is Studio closing the pipe, which is how a harness is asked to stop.
lines.on('close', (): void => process.exit(0));
