#!/usr/bin/env node
// The Claude agent harness: Anthropic's Agent SDK, driven in its own process, speaking Studio's agent
// protocol (#653).
//
// This is the relationship `rust-analyzer` has to LSP. The vendor SDK still runs — it just runs *here*,
// in a process Studio launched and talks to over a pipe, rather than inside Studio itself. That is the
// whole point of the exercise: nothing of Anthropic's executes in the application's process, and the
// vocabulary between them is one core defines.
//
// ## ⚠️ This adapter is deliberately incomplete, and deliberately does not claim `claude-login`
//
// The in-core `ClaudeAgentProvider` is ~2,900 lines. Most of that is not the turn loop — it is hooks,
// tool policy, MCP servers, write confinement, sub-agent attribution, remote control and background
// tasks. What is here is the turn: prompt in, text and thinking and tool activity out, permission asked
// and answered, abort, settle.
//
// Because contributed harnesses register *ahead* of the in-core ones, an adapter claiming `claude-login`
// would take that connection and silently drop everything it does not implement. So its manifest claims
// the separate `claude-harness` auth kind: a user opts into it by creating a connection of that kind,
// the built-in path is untouched, and the day this reaches parity it can claim `claude-login` and the
// in-core provider stops being registered.

import {
  query,
  type Options,
  type PermissionResult,
  type Query,
} from '@anthropic-ai/claude-agent-sdk';
import { createInterface } from 'node:readline';
import {
  type Answer,
  type HarnessMessage,
  type HostMessage,
  PROTOCOL_VERSION,
  type Request,
  type TurnRequest,
} from './protocol';

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
 * Holds the turn in flight, so an abort or a steer knows what it belongs to.
 */
let running: { requestId: string; query: Query; abort: AbortController } | null = null;

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
 * Builds the SDK options for a turn.
 *
 * ⚠️ The write confinement here is what the manifest cannot express and what the protocol carries
 * instead: Studio computes the boundary and sends it, and the harness applies it. A harness that
 * ignored these would be writing outside what the user permitted, which is why they are in the turn
 * envelope rather than left to the harness's own configuration.
 * @param turn The turn envelope.
 * @returns Returns the options.
 */
function optionsFor(turn: TurnRequest): Options {
  const options: Options = {
    model: turn.model,
    cwd: turn.workspaceRoot ?? undefined,
    // A chat turn may read and may not act. The in-core provider expresses this the same way.
    permissionMode: turn.mode === 'chat' ? 'plan' : 'default',
    additionalDirectories: [...turn.allowedWritePaths],
    canUseTool: async (name: string, input: Record<string, unknown>): Promise<PermissionResult> => {
      const requestId: string | undefined = running?.requestId;
      if (requestId === undefined) {
        return { behavior: 'deny', message: 'No turn is running.' };
      }
      const answer: Answer = await ask(requestId, {
        kind: 'permission',
        name,
        detail: describeInput(input),
      });
      if (answer.kind === 'permission' && answer.granted) {
        // Recorded at the point it was allowed, which is what makes the audit log a record of what
        // happened rather than of what was asked.
        send({ type: 'audit', name, detail: describeInput(input), source: 'user' });
        return { behavior: 'allow' };
      }
      return { behavior: 'deny', message: 'The user did not permit this.' };
    },
  };
  if (turn.resumeSessionId !== null) {
    options.resume = turn.resumeSessionId;
    options.forkSession = turn.forkSession;
  }
  return options;
}

/**
 * Summarises a tool's input for a permission prompt, in one line.
 *
 * ⚠️ Kept short and kept a string. It reaches a prompt a person is about to answer, so a wall of JSON
 * would make the decision harder rather than better informed.
 * @param input The tool input.
 * @returns Returns the summary.
 */
function describeInput(input: Record<string, unknown>): string {
  const first: unknown =
    input['command'] ?? input['file_path'] ?? input['path'] ?? input['pattern'];
  if (typeof first === 'string') {
    return first.length > 200 ? `${first.slice(0, 200)}…` : first;
  }
  const rendered: string = JSON.stringify(input);
  return rendered.length > 200 ? `${rendered.slice(0, 200)}…` : rendered;
}

/**
 * Translates one SDK message into Studio's transcript events.
 * @param message The SDK message.
 * @param requestId The run it belongs to.
 * @returns Returns the session id when the message carries one, else null.
 */
function translate(message: Record<string, unknown>, requestId: string): string | null {
  const parentToolId: unknown = message['parent_tool_use_id'];
  const parent: Record<string, unknown> = typeof parentToolId === 'string' ? { parentToolId } : {};
  if (message['type'] === 'assistant') {
    const body: Record<string, unknown> = (message['message'] ?? {}) as Record<string, unknown>;
    const blocks: unknown = body['content'];
    if (Array.isArray(blocks)) {
      for (const block of blocks as readonly Record<string, unknown>[]) {
        translateBlock(block, requestId, parent);
      }
    }
  }
  if (message['type'] === 'result') {
    const usage: Record<string, unknown> = (message['usage'] ?? {}) as Record<string, unknown>;
    emit({
      requestId,
      kind: 'usage',
      inputTokens: Number(usage['input_tokens'] ?? 0),
      outputTokens: Number(usage['output_tokens'] ?? 0),
    });
  }
  const session: unknown = message['session_id'];
  return typeof session === 'string' ? session : null;
}

/**
 * Translates one assistant content block.
 * @param block The block.
 * @param requestId The run it belongs to.
 * @param parent The sub-agent attribution, when the block belongs to one.
 */
function translateBlock(
  block: Record<string, unknown>,
  requestId: string,
  parent: Record<string, unknown>,
): void {
  if (block['type'] === 'text' && typeof block['text'] === 'string') {
    emit({ requestId, kind: 'text', delta: block['text'], ...parent });
    return;
  }
  if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
    emit({ requestId, kind: 'thinking', delta: block['thinking'], ...parent });
    return;
  }
  if (block['type'] === 'tool_use') {
    emit({
      requestId,
      kind: 'tool-start',
      toolId: typeof block['id'] === 'string' ? block['id'] : '',
      name: typeof block['name'] === 'string' ? block['name'] : '',
      detail: describeInput((block['input'] ?? {}) as Record<string, unknown>),
      ...parent,
    });
  }
}

/**
 * Runs one turn.
 * @param turn The turn envelope.
 */
async function runTurn(turn: TurnRequest): Promise<void> {
  const abort: AbortController = new AbortController();
  let sessionId: string | null = null;
  try {
    const stream: Query = query({
      prompt: turn.prompt,
      options: { ...optionsFor(turn), abortController: abort },
    });
    running = { requestId: turn.requestId, query: stream, abort };
    for await (const message of stream) {
      const session: string | null = translate(message, turn.requestId);
      sessionId ??= session;
    }
    send({ type: 'turn.completed', requestId: turn.requestId, sessionId });
  } catch (error: unknown) {
    send({
      type: 'turn.failed',
      requestId: turn.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = null;
    // Anything still waiting belongs to a turn that has ended; Studio refuses these locally too, but
    // clearing here stops a late answer resolving into nothing.
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
          // One process per turn today, so nothing is held open between them. This becomes
          // `live-harness` when the session path lands, not before — declaring it early would have
          // Studio offer resumption this cannot honour.
          sessionModel: 'stateless',
          // The SDK takes streaming input; this adapter does not wire it yet, and saying so means
          // Studio queues a steer for the next turn rather than dropping it.
          steering: false,
          images: false,
          efforts: [],
          resumable: false,
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
      running?.abort.abort();
      break;
    case 'steer':
      // Refused rather than dropped silently: `steering: false` was declared, so Studio has already
      // queued this. Reaching here at all would be Studio ignoring the handshake.
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
