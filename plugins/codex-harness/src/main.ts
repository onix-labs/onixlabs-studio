#!/usr/bin/env node
// The Codex agent harness: OpenAI's Codex SDK, driven in its own process, speaking Studio's agent
// protocol (#653).
//
// The first port to go for **parity** rather than for a demonstration. `CodexAgentProvider` is 658
// lines against Claude's 2,922, and almost all of that is turn translation rather than the hooks, tool
// policy and MCP machinery that make Claude's port a longer job — which is why Codex is the harness
// that proves the seam.
//
// ## What is deliberately absent, and why that is not a loss
//
// The in-core provider carries `resolveBundledCodexExecutable`: 54 lines that exist only because the
// SDK sits inside `app.asar`, where a native binary cannot be spawned, so it needs an `asarUnpack`ed
// copy passed as `codexPathOverride`. **A plugin has no asar.** Its `node_modules` are a real directory
// under the user's data folder, so the SDK resolves its own per-platform binary exactly as it does in a
// development run. The workaround was a consequence of being in core, and moving out deletes it rather
// than porting it.

import { Codex } from '@openai/codex-sdk';
import type { CodexOptions, ThreadEvent, ThreadItem, ThreadOptions } from '@openai/codex-sdk';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Answer,
  type HarnessMessage,
  type HostMessage,
  PROTOCOL_VERSION,
  type Request,
  type TurnRequest,
} from './protocol';

/**
 * Codex CLI notices Studio turns off, as raw `--config` overrides.
 *
 * Carried over verbatim from the in-core provider, and for the reason recorded there: with an
 * under-development feature enabled in the user's own `~/.codex/config.toml`, the CLI emits a warning
 * that reached the transcript joined onto the front of the model's reply with no separator (#541). The
 * model appeared to say something it had not.
 *
 * ⛔ Suppressed at the source rather than stripped afterwards. Matching a notice by its text means
 * tracking someone else's wording forever, and getting it wrong either leaves the noise or eats a real
 * first line of a reply.
 */
const SUPPRESSED_CLI_NOTICES: readonly string[] = ['suppress_unstable_features_warning=true'];

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
 * Holds the answers Studio owes this harness, by call id.
 */
const awaiting: Map<string, (answer: Answer) => void> = new Map<string, (answer: Answer) => void>();

/**
 * Counts questions asked, so each gets its own correlation id.
 */
let calls: number = 0;

/**
 * Holds the Codex client, built once the first turn has told us how to authenticate.
 */
let client: Codex | null = null;

/**
 * Holds the conversation thread, kept across turns — this harness is a `live-harness`.
 */
let thread: ReturnType<Codex['startThread']> | null = null;

/**
 * Holds the thread id once Codex has reported one, so a resumed session is reported only once.
 */
let reportedThreadId: string | null = null;

/**
 * Holds the turn in flight, so an abort knows what to cancel.
 */
let running: { requestId: string; controller: AbortController } | null = null;

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
 * Determines whether the machine has a local Codex login.
 *
 * Asked here rather than of Studio, because it is a question about **this** process's environment: the
 * CLI reads its own credential store, and the harness is the thing running beside it. Studio's own
 * `hasCodexLogin` answers the same question for the in-core provider, and deliberately does not cross
 * the wire — a harness that can look is not told.
 * @returns Returns true when a Codex login is present.
 */
function hasLocalLogin(): boolean {
  return existsSync(join(homedir(), '.codex', 'auth.json'));
}

/**
 * Builds the Codex client options for a turn.
 *
 * ⛔ No `codexPathOverride`. See the note at the top of this file: the override exists only for a build
 * where the SDK lives inside an asar archive, which a plugin never does.
 * @param turn The turn envelope.
 * @returns Returns the client options.
 */
async function clientOptionsFor(turn: TurnRequest): Promise<CodexOptions> {
  const options: CodexOptions = { configOverrides: [...SUPPRESSED_CLI_NOTICES] };
  if (hasLocalLogin()) {
    return options;
  }
  // No local login, so the CLI needs a key — and the key is Studio's, held in its encrypted store. This
  // is the round-trip protocol 1.1.0 exists for: asked at the point of use rather than handed over in
  // the turn envelope, so it never rides the wire for a harness that did not need it.
  const answer: Answer = await ask(turn.requestId, { kind: 'credential' });
  if (answer.kind === 'credential' && answer.apiKey !== null) {
    options.apiKey = answer.apiKey;
  }
  return options;
}

/**
 * Builds the Codex thread options from a turn envelope.
 *
 * Confinement is enforced through Codex's sandbox: a chat turn is read-only; an agent turn may write,
 * but only within the working directory plus the paths Studio permitted. The boundary is Studio's to
 * decide and this harness's to apply — which is why it rides in the envelope rather than being left to
 * the harness's own configuration.
 * @param turn The turn envelope.
 * @returns Returns the thread options.
 */
function threadOptionsFor(turn: TurnRequest): ThreadOptions {
  const readOnly: boolean = turn.mode === 'chat';
  const options: ThreadOptions = {
    model: turn.model,
    sandboxMode: readOnly ? 'read-only' : 'workspace-write',
    workingDirectory: turn.workspaceRoot ?? homedir(),
    approvalPolicy: 'never',
    // A Studio workspace is not necessarily a git repository.
    skipGitRepoCheck: true,
  };
  // `max` is excluded: Codex's range tops out at `xhigh`, and Studio already clamps to what the
  // handshake declared. This guards the type rather than the value.
  if (turn.effort !== null && turn.effort !== 'max') {
    options.modelReasoningEffort = turn.effort as ThreadOptions['modelReasoningEffort'];
  }
  if (turn.allowedWritePaths.length > 0) {
    options.additionalDirectories = [...turn.allowedWritePaths];
  }
  // ⚠️ Codex's sandbox has one network switch, not a host list, so a configured allow list cannot be
  // expressed and the honest mapping is to fail closed. A deny list alone is left as-is: it narrows
  // nothing this harness can act on, and cutting the network entirely over one denied host would be a
  // surprise out of proportion to what was asked. Carried over from the in-core provider unchanged.
  if (turn.allowedNetworkLocations.length > 0) {
    options.networkAccessEnabled = false;
  }
  return options;
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
 * Reports the thread id the first time Codex names one.
 * @param threadId The thread id.
 * @param requestId The run reporting it.
 */
function reportThread(threadId: string, requestId: string): void {
  if (threadId.length === 0 || threadId === reportedThreadId) {
    return;
  }
  reportedThreadId = threadId;
  emit({ requestId, kind: 'session', sessionId: threadId });
}

/**
 * Tracks how much of each streaming item has already been emitted, so an update emits only the new
 * suffix. Codex sends the whole text each time; Studio's transcript takes deltas.
 */
const emitted: Map<string, number> = new Map<string, number>();

/**
 * Emits the unseen tail of a streaming text item.
 * @param id The item id.
 * @param text The item's full text so far.
 * @param kind Which transcript stream it belongs to.
 * @param requestId The run it belongs to.
 */
function emitTextDelta(
  id: string,
  text: string,
  kind: 'text' | 'thinking',
  requestId: string,
): void {
  const already: number = emitted.get(id) ?? 0;
  if (text.length <= already) {
    return;
  }
  emitted.set(id, text.length);
  emit({ requestId, kind, delta: text.slice(already) });
}

/**
 * Translates one Codex thread item into Studio's transcript events.
 * @param item The thread item.
 * @param completed Whether the item has reached its terminal state.
 * @param requestId The run it belongs to.
 */
function translateItem(item: ThreadItem, completed: boolean, requestId: string): void {
  const toolEnd: (ok: boolean, output?: string) => void = (ok: boolean, output?: string): void =>
    void emit({ requestId, kind: 'tool-end', toolId: item.id, ok, detail: output ?? '' });
  const toolStart: (name: string, detail: string) => void = (name: string, detail: string): void =>
    void emit({ requestId, kind: 'tool-start', toolId: item.id, name, detail });
  switch (item.type) {
    case 'agent_message':
      emitTextDelta(item.id, item.text, 'text', requestId);
      break;
    case 'reasoning':
      emitTextDelta(item.id, item.text, 'thinking', requestId);
      break;
    case 'command_execution':
      if (completed) {
        toolEnd(item.status === 'completed', item.aggregated_output);
      } else {
        toolStart('Shell', item.command);
      }
      break;
    case 'file_change':
      if (completed) {
        toolEnd(item.status === 'completed');
      } else {
        toolStart(
          'Edit',
          item.changes
            .map(
              (change: { path: string; kind: string }): string => `${change.kind} ${change.path}`,
            )
            .join(', '),
        );
      }
      break;
    case 'mcp_tool_call':
      if (completed) {
        toolEnd(item.error === undefined);
      } else {
        toolStart(`${item.server} / ${item.tool}`, item.tool);
      }
      break;
    case 'web_search':
      if (completed) {
        toolEnd(true);
      } else {
        toolStart('Web search', item.query);
      }
      break;
    case 'error':
      if (completed) {
        emit({ requestId, kind: 'text', delta: item.message });
      }
      break;
    // todo_list carries no transcript content.
  }
}

/**
 * Translates one Codex thread event.
 * @param event The event.
 * @param requestId The run it belongs to.
 */
function translateEvent(event: ThreadEvent, requestId: string): void {
  switch (event.type) {
    case 'thread.started':
      reportThread(event.thread_id, requestId);
      break;
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      translateItem(event.item, event.type === 'item.completed', requestId);
      break;
    case 'turn.completed':
      emit({
        requestId,
        kind: 'usage',
        inputTokens: event.usage.input_tokens ?? 0,
        outputTokens: event.usage.output_tokens ?? 0,
      });
      break;
    case 'turn.failed':
      throw new Error(event.error.message);
    case 'error':
      throw new Error(event.message);
    // turn.started carries no transcript content.
  }
}

/**
 * Opens the thread on the first turn, resuming a persisted one when the envelope names it.
 * @param turn The turn envelope.
 */
async function openThread(turn: TurnRequest): Promise<void> {
  client ??= new Codex(await clientOptionsFor(turn));
  const options: ThreadOptions = threadOptionsFor(turn);
  thread =
    turn.resumeSessionId !== null
      ? client.resumeThread(turn.resumeSessionId, options)
      : client.startThread(options);
}

/**
 * Runs one turn.
 * @param turn The turn envelope.
 */
async function runTurn(turn: TurnRequest): Promise<void> {
  const controller: AbortController = new AbortController();
  running = { requestId: turn.requestId, controller };
  try {
    if (thread === null) {
      await openThread(turn);
    }
    const stream: Awaited<ReturnType<NonNullable<typeof thread>['runStreamed']>> =
      await thread!.runStreamed(promptFor(turn), { signal: controller.signal });
    for await (const event of stream.events) {
      translateEvent(event, turn.requestId);
    }
    send({ type: 'turn.completed', requestId: turn.requestId, sessionId: reportedThreadId });
  } catch (error: unknown) {
    // An aborted turn is not a failure: Studio already knows it stopped the run, and reporting it as an
    // error would land a stopped turn in the transcript as a red one.
    if (controller.signal.aborted) {
      send({ type: 'turn.completed', requestId: turn.requestId, sessionId: reportedThreadId });
    } else {
      send({
        type: 'turn.failed',
        requestId: turn.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    running = null;
    emitted.clear();
    awaiting.clear();
  }
}

/**
 * Handles one message from Studio.
 * @param message The message.
 */
function receive(message: HostMessage): void {
  switch (message.type) {
    case 'initialize':
      send({
        type: 'ready',
        capabilities: {
          protocolVersion: PROTOCOL_VERSION,
          // ⛔ Must match the manifest, or Studio refuses the harness. It has already decided to hold
          // this process open on the manifest's word.
          sessionModel: 'live-harness',
          // The SDK takes one input per turn; a mid-turn injection is not something it accepts, so
          // Studio queues a steer for the next turn rather than dropping it.
          steering: false,
          images: false,
          efforts: ['low', 'medium', 'high', 'xhigh'],
          resumable: true,
          // The claude.ai bridge is Anthropic's; Codex has no equivalent this harness drives.
          remoteControl: false,
        },
      });
      break;
    case 'turn.start':
      void runTurn(message.turn);
      break;
    case 'answer': {
      const resolve: ((answer: Answer) => void) | undefined = awaiting.get(message.callId);
      awaiting.delete(message.callId);
      resolve?.(message.answer);
      break;
    }
    case 'turn.abort':
      // Cancels the turn and leaves the thread open, which is what makes this a session rather than a
      // sequence of runs: the next turn continues the same conversation.
      running?.controller.abort();
      break;
    case 'steer':
    case 'remote-control':
      // Both declined at the handshake, so Studio has already handled them — a steer is queued for the
      // next turn and remote control is never aimed here. Reaching this would be Studio ignoring the
      // handshake, which is worth neither crashing over nor acting on.
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
