#!/usr/bin/env node
// The Claude agent harness: Anthropic's Agent SDK, driven in its own process, speaking Studio's agent
// protocol (#653).
//
// This is the relationship `rust-analyzer` has to LSP. The vendor SDK still runs — it just runs *here*,
// in a process Studio launched and talks to over a pipe, rather than inside the application. Nothing
// of Anthropic's executes in Studio's process, and the vocabulary between them is one core defines.
//
// ## This is the parity port
//
// The first version of this plugin ran a turn and little else, which is why a connection had to opt
// into it and the in-core `ClaudeAgentProvider` stayed registered. It no longer does: sessions held
// open across turns, sub-agent attribution, background tasks, slash commands, tool policy, write
// confinement, the OS sandbox, the agent shell, model discovery and Remote Control are all here. The
// in-core provider is gone, and this is what replaced it.
//
// ## What did NOT come across, and why that is not a loss
//
//   - **the bundled-executable resolution.** 40 lines in core that existed only because the SDK sat
//     inside `app.asar`, where a native binary cannot be spawned. A plugin has no asar, so the SDK
//     resolves its own per-platform binary. The Codex port found exactly the same thing.
//   - **the managed spawner.** Core registered the CLI in Studio's pid journal and killed its process
//     tree, so a Bash tool mid-build did not keep building headless. This process is *itself* spawned
//     as a process-group leader and journalled by `HarnessProcess`, and the CLI inherits that group —
//     so closing the harness already ends the whole subtree. The workaround was a consequence of
//     being in core.
//   - **Studio's twenty-eight tool declarations.** Core answers a `tools` request with them now, so
//     they are described once rather than restated here. See `tools.ts`.
//
// ## What is genuinely different
//
// Prompts for **Studio's own tools** are not raced against a claude.ai peer, because Studio raises
// them on its own side of the seam. The SDK's built-in tools — which is everything that touches the
// user's machine — are raced exactly as before. See the note at the top of `tools.ts`.

import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import type { ModelInfo, Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { hasLocalLogin, resolveExecutable } from './environment';
import { note } from './log';
import {
  type Answer,
  type HarnessMessage,
  type HarnessModel,
  type HostMessage,
  PROTOCOL_VERSION,
  type Request,
} from './protocol';
import { Session, type Host } from './session';

/**
 * The host messages this harness answers, beyond the four that are never gated.
 *
 * ⛔ Studio refuses to send anything absent from this list, which is what makes an unimplemented
 * message an immediate "cannot" rather than a turn that hangs waiting for a reply. Adding a message
 * to the loop below without adding it here means Studio never delivers it.
 */
const ANSWERS: readonly string[] = ['steer', 'remote-control', 'discover', 'task.stop', 'panic'];

/**
 * The reasoning-effort levels the Agent SDK offers, ascending. `minimal` is deliberately absent — it
 * is not one of the SDK's levels.
 */
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Holds the answers Studio owes this harness, by call id.
 */
const awaiting: Map<string, (answer: Answer) => void> = new Map<string, (answer: Answer) => void>();

/**
 * Counts questions asked, so each gets its own correlation id.
 */
let calls: number = 0;

/**
 * Holds the settings Studio sent at the handshake, which say which connection this serves.
 */
let settings: Readonly<Record<string, unknown>> = {};

/**
 * Holds the conversation, opened lazily on the first turn.
 */
let session: Session | null = null;

/**
 * Writes one protocol message to Studio.
 *
 * ⛔ stdout carries the protocol and nothing else. Diagnostics go to stderr — see `log.ts`.
 * @param message The message to send.
 */
function send(message: HarnessMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Gets the refusal shape for a question, matching what Studio would send.
 *
 * Used when a question is withdrawn locally: the caller is still awaiting a promise, and resolving it
 * as "no answer" is what unblocks the code that asked.
 * @param request The question being abandoned.
 * @returns Returns the refusal.
 */
function refusalFor(request: Request): Answer {
  switch (request.kind) {
    case 'input':
      return { kind: 'input', answer: null };
    case 'edit-decision':
      return { kind: 'edit-decision', decision: 'no' };
    case 'bridge':
      return { kind: 'bridge', result: null, error: 'withdrawn' };
    case 'credential':
      return { kind: 'credential', apiKey: null };
    case 'tools':
      return { kind: 'tools', tools: [], systemPrompt: '' };
    case 'tool':
      return { kind: 'tool', result: null, error: 'withdrawn' };
    default:
      return { kind: 'permission', granted: false };
  }
}

/**
 * Asks Studio a blocking question.
 *
 * The returned `withdraw` both tells Studio to take the prompt off the user's screen and settles the
 * promise locally as "no answer" — a question answered by a claude.ai peer must not leave this side
 * waiting on a prompt nobody is going to touch.
 * @param requestId The run the question belongs to.
 * @param request The question.
 * @returns Returns the answer, and a way to withdraw the question.
 */
function ask(
  requestId: string,
  request: Request,
): { readonly answer: Promise<Answer>; readonly withdraw: () => void } {
  calls += 1;
  const callId: string = `call-${calls}`;
  let settle: ((answer: Answer) => void) | null = null;
  const answer: Promise<Answer> = new Promise<Answer>((resolve): void => {
    settle = resolve;
    awaiting.set(callId, resolve);
    send({ type: 'request', callId, requestId, request });
  });
  return {
    answer,
    withdraw: (): void => {
      if (!awaiting.delete(callId)) {
        return;
      }
      send({ type: 'cancel', callId });
      settle?.(refusalFor(request));
    },
  };
}

/**
 * How the session reaches Studio.
 */
const host: Host = { send, ask };

/**
 * Lists the models the SDK reports for the current login.
 *
 * Runs over a short-lived query's control channel: no turn is sent, so this works for a local-login
 * connection that has no API key to drive an HTTP discovery. The SDK's streaming-input mode keeps the
 * session open until the prompt generator completes, so the generator yields nothing and returns once
 * the answer is in.
 * @param discoveryId The id to answer under.
 */
async function discover(discoveryId: string): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let release: () => void = (): void => undefined;
  const released: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  async function* keepOpen(): AsyncGenerator<SDKUserMessage> {
    await released;
    yield* [];
  }
  const executable: string | undefined = resolveExecutable(
    settings['claudeExecutable'],
    process.env,
  );
  const options: Options =
    executable === undefined ? {} : { pathToClaudeCodeExecutable: executable };
  let sdkQuery: Query | null = null;
  try {
    sdkQuery = query({ prompt: keepOpen(), options });
    const models: readonly ModelInfo[] = await sdkQuery.supportedModels();
    send({
      type: 'models',
      discoveryId,
      models: models.map((model: ModelInfo): HarnessModel => ({
        id: model.value,
        ...(typeof model.displayName === 'string' && model.displayName.length > 0
          ? { label: model.displayName }
          : {}),
      })),
      // Read only when the list is empty, and this is the case it exists for: without a login the SDK
      // reports nothing, and "reported no models" would send the user looking in the wrong place.
      ...(models.length === 0 && !hasLocalLogin(homedir())
        ? { detail: 'Run `claude` to log in, or add an Anthropic API key to this connection.' }
        : {}),
    });
  } catch (error: unknown) {
    send({
      type: 'models',
      discoveryId,
      models: [],
      detail: `The Claude CLI could not be asked: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    release();
    try {
      await sdkQuery?.interrupt();
    } catch {
      // Best-effort teardown of a short-lived discovery query.
    }
  }
}

/**
 * Handles one message from Studio.
 * @param message The message.
 */
function receive(message: HostMessage): void {
  switch (message.type) {
    case 'initialize':
      settings = message.settings ?? {};
      send({
        type: 'ready',
        capabilities: {
          protocolVersion: PROTOCOL_VERSION,
          // ⛔ Must match the manifest, or Studio refuses the harness outright: it has already decided
          // to hold this process open on the manifest's word, and a `stateless` harness kept alive
          // would collect turns it cannot relate to one another.
          sessionModel: 'live-harness',
          answers: [...ANSWERS],
          // Claude's models are multimodal, and this is a fact about the provider rather than about
          // the harness — which is why 1.8.0 moved the settings onto `initialize`.
          images: true,
          efforts: [...EFFORTS],
          resumable: true,
        },
      });
      break;
    case 'turn.start':
      session ??= new Session(host, message.turn);
      void session.run(message.turn);
      break;
    case 'answer': {
      const resolve: ((answer: Answer) => void) | undefined = awaiting.get(message.callId);
      awaiting.delete(message.callId);
      resolve?.(message.answer);
      break;
    }
    case 'turn.abort':
      // Cancels the turn and leaves the session open, which is what makes this a conversation rather
      // than a sequence of runs: the next turn continues where this one stopped.
      session?.interrupt();
      break;
    case 'steer':
      session?.steer(message.text);
      break;
    case 'remote-control':
      session?.setRemoteControl(message.mode);
      break;
    case 'task.stop':
      session?.stopTask(message.taskId);
      break;
    case 'panic':
      session?.panic();
      break;
    case 'discover':
      void discover(message.discoveryId);
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
  } catch (error: unknown) {
    // Not JSON, so not a message. Studio never sends one; ignoring beats dying.
    note(`main: discarded a line that is not a message: ${String(error)}`);
  }
});
// End of input is Studio closing the pipe, which is how a harness is asked to stop. The session is
// closed first so the CLI subprocess and any claude.ai bridge go down with it rather than being
// orphaned for the process-tree kill to catch.
lines.on('close', (): void => {
  void (session === null ? Promise.resolve() : session.close()).finally((): never =>
    process.exit(0),
  );
});
