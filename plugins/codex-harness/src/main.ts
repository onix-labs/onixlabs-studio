#!/usr/bin/env node
// The Codex agent harness: OpenAI's Codex, driven as an app-server in its own process, speaking
// Studio's agent protocol (#653).
//
// ## Why the app-server and not the SDK
//
// The Codex SDK runs `codex exec`, which runs a turn to completion on its own: it never asks anyone
// before a command runs or a file changes, so Studio's posture, its per-tool policy and its permission
// card were all passed over. The app-server is the CLI's interactive face — the one the Codex desktop
// app and IDE extensions speak — and it puts every such action to its client as a request. This
// harness answers those requests the way the Claude harness answers `canUseTool`: under the user's
// settings, through Studio's prompt, with Studio keeping the audit record.
//
// ⛔ Execution never happens here. Codex runs its own commands inside its own sandbox; Studio's tools
// are served to it over a loopback MCP server (#854) and run by Studio.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { type AppServerProcess, spawnAppServer } from './app-server';
import { CodexClient } from './codex-client';
import { findCodexExecutable } from './codex-executable';
import { CodexModels, readCodexModels } from './codex-models';
import {
  auditSource,
  COMMAND_TOOL,
  decideCommand,
  decideFileChange,
  decidePermissions,
  type Decision,
  EDIT_TOOL,
  policyFor,
  type TurnPolicy,
} from './policy';
import {
  type Answer,
  type HarnessMessage,
  type HostMessage,
  PROTOCOL_VERSION,
  type Request,
  type StudioTool,
  type TurnRequest,
} from './protocol';
import { startStudioMcpServer } from './studio-mcp';

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
 * Writes a diagnostic line, which Studio keeps in its log.
 * @param message The line.
 */
function note(message: string): void {
  process.stderr.write(`[codex-harness] ${message}\n`);
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
 * Holds the turn in flight: Studio's run, Codex's turn, and how to settle it.
 */
let running: {
  readonly turn: TurnRequest;
  readonly policy: TurnPolicy;
  turnId: string | null;
  usage: { inputTokens: number; outputTokens: number; contextWindow: number | null } | null;
  failure: string | null;
  readonly done: (outcome: 'completed' | 'failed') => void;
} | null = null;

/**
 * Holds, per Codex item, why its action was allowed, for the audit record written when it completes.
 */
const allowed: Map<string, string> = new Map<string, string>();

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
 * CLI reads its own credential store, and the harness is the thing running beside it.
 * @returns Returns true when a Codex login is present.
 */
function hasLocalLogin(): boolean {
  return existsSync(join(codexHome(), 'auth.json'));
}

/**
 * Gets the Codex CLI's home, where it keeps its login and its list of the account's models.
 * @returns Returns `$CODEX_HOME`, or `~/.codex`.
 */
function codexHome(): string {
  const configured: string | undefined = process.env['CODEX_HOME'];
  return configured !== undefined && configured.length > 0 ? configured : join(homedir(), '.codex');
}

/**
 * Assembles the prompt Studio's own providers assemble, from the envelope's context attachments.
 * Kept identical so an attached file reads the same whichever provider runs it.
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
        `file tools as needed to answer:\n${lines}`,
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
 * Reads a record out of an unknown value.
 * @param value The value.
 * @returns Returns the record, empty when the value is not one.
 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Reads a string field, or a fallback.
 * @param value The record.
 * @param key The field.
 * @param fallback What to return when the field is not a string.
 * @returns Returns the string.
 */
function text(value: Record<string, unknown>, key: string, fallback: string = ''): string {
  const field: unknown = value[key];
  return typeof field === 'string' ? field : fallback;
}

/**
 * Builds the sandbox Codex runs a turn's commands in.
 * @param policy The turn's confinement.
 * @returns Returns the sandbox policy.
 */
function sandboxPolicy(policy: TurnPolicy): Record<string, unknown> {
  return policy.sandbox === 'read-only'
    ? { type: 'readOnly', networkAccess: policy.networkAccess }
    : {
        type: 'workspaceWrite',
        writableRoots: [...policy.writableRoots],
        networkAccess: policy.networkAccess,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
}

/**
 * Holds Codex: the app-server, Studio's tool server and the thread, started on the first turn and kept
 * across turns — this harness is a `live-harness`.
 */
const codex: CodexClient = new CodexClient({
  findExecutable: findCodexExecutable,
  spawn: spawnAppServer,
  startTools: startStudioMcpServer,
  bridge: {
    describe: async (): Promise<readonly StudioTool[]> => {
      if (running === null) {
        return [];
      }
      const answer: Answer = await ask(running.turn.requestId, { kind: 'tools' });
      return answer.kind === 'tools' ? answer.tools : [];
    },
    invoke: async (
      name: string,
      input: unknown,
    ): Promise<{ result: string | null; error: string | null }> => {
      if (running === null) {
        return { result: null, error: 'No turn is running, so Studio cannot run the tool.' };
      }
      const answer: Answer = await ask(running.turn.requestId, { kind: 'tool', name, input });
      return answer.kind === 'tool'
        ? { result: answer.result, error: answer.error }
        : { result: null, error: 'Studio did not run the tool.' };
    },
  },
  apiKey: async (requestId: string): Promise<string | null> => {
    if (hasLocalLogin()) {
      return null;
    }
    // No local login, so the CLI needs a key — and the key is Studio's, held in its encrypted store.
    // Asked at the point of use rather than handed over in the turn envelope.
    const answer: Answer = await ask(requestId, { kind: 'credential' });
    return answer.kind === 'credential' ? answer.apiKey : null;
  },
  onNotification: (method: string, params: unknown): void => onNotification(method, params),
  onRequest: (method: string, params: unknown): Promise<unknown> => onRequest(method, params),
  onLost: (error: Error | null): void => {
    if (running !== null) {
      running.failure ??= error?.message ?? 'Codex stopped unexpectedly.';
      running.done('failed');
    }
  },
  onSession: (requestId: string, threadId: string): void =>
    emit({ requestId, kind: 'session', sessionId: threadId }),
  note,
});

/**
 * Runs one turn.
 * @param turn The turn envelope.
 */
async function runTurn(turn: TurnRequest): Promise<void> {
  const policy: TurnPolicy = policyFor(turn);
  let settle: (outcome: 'completed' | 'failed') => void = (): void => undefined;
  const finished: Promise<'completed' | 'failed'> = new Promise<'completed' | 'failed'>(
    (resolve: (outcome: 'completed' | 'failed') => void): void => {
      settle = resolve;
    },
  );
  running = {
    turn,
    policy,
    turnId: null,
    usage: null,
    failure: null,
    done: (outcome: 'completed' | 'failed'): void => settle(outcome),
  };
  try {
    const started: AppServerProcess | string = await codex.ensureServer(turn.requestId);
    if (typeof started === 'string') {
      throw new Error(started);
    }
    // Asked every turn, so an edit to a prompt profile or a skill applies from the next message
    // rather than the next restart (#955): the client reloads the thread when the text has changed.
    const offer: Answer = await ask(turn.requestId, { kind: 'tools' });
    const instructions: string = offer.kind === 'tools' ? offer.systemPrompt : '';
    const thread: string = await codex.ensureThread(turn, policy, instructions);
    // The thread may have been reloaded into a fresh app-server, so the turn goes to whichever runs now.
    const current: AppServerProcess | null = codex.server;
    if (current === null) {
      throw new Error('Codex stopped before the turn could start.');
    }
    const response: Record<string, unknown> = record(
      await current.connection.request('turn/start', {
        threadId: thread,
        input: [{ type: 'text', text: promptFor(turn), text_elements: [] }],
        ...(turn.model.length > 0 ? { model: turn.model } : {}),
        // `max` is excluded: Codex's range tops out at `xhigh`.
        ...(turn.effort !== null && turn.effort !== 'max' ? { effort: turn.effort } : {}),
        approvalPolicy: policy.approvalPolicy,
        sandboxPolicy: sandboxPolicy(policy),
      }),
    );
    running.turnId = text(record(response['turn']), 'id') || null;
    const outcome: 'completed' | 'failed' = await finished;
    if (outcome === 'failed') {
      throw new Error(running.failure ?? 'Codex did not finish the turn.');
    }
    if (running.usage !== null) {
      emit({
        requestId: turn.requestId,
        kind: 'usage',
        inputTokens: running.usage.inputTokens,
        outputTokens: running.usage.outputTokens,
        costUsd: null,
        ...(running.usage.contextWindow === null
          ? {}
          : { contextWindow: running.usage.contextWindow }),
      });
    }
    codex.turnCompleted();
    send({ type: 'turn.completed', requestId: turn.requestId, sessionId: codex.threadId });
  } catch (error: unknown) {
    send({
      type: 'turn.failed',
      requestId: turn.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = null;
    allowed.clear();
  }
}

/**
 * Stops the turn in flight, leaving the thread open so the next turn continues the conversation.
 */
function abortTurn(): void {
  const server: AppServerProcess | null = codex.server;
  const threadId: string | null = codex.threadId;
  if (running === null || server === null) {
    return;
  }
  if (running.turnId !== null && threadId !== null) {
    void server.connection
      .request('turn/interrupt', { threadId, turnId: running.turnId })
      .catch((error: unknown): void => note(`interrupt failed: ${String(error)}`));
  } else {
    // Nothing has started on Codex's side yet; settle the run as finished rather than wait.
    running.done('completed');
  }
}

/**
 * Translates one Codex item, starting or completing, into Studio's transcript events.
 * @param item The item.
 * @param completed Whether the item has reached its terminal state.
 */
function translateItem(item: Record<string, unknown>, completed: boolean): void {
  if (running === null) {
    return;
  }
  const requestId: string = running.turn.requestId;
  const id: string = text(item, 'id');
  const toolStart: (name: string, detail: string) => void = (name: string, detail: string): void =>
    emit({ requestId, kind: 'tool-start', toolId: id, name, detail });
  const toolEnd: (ok: boolean, output?: string) => void = (ok: boolean, output?: string): void =>
    emit({ requestId, kind: 'tool-end', toolId: id, ok, detail: output ?? '' });
  const status: string = text(item, 'status');
  switch (item['type']) {
    case 'commandExecution': {
      const command: string = text(item, 'command');
      if (!completed) {
        toolStart('Shell', command);
      } else {
        toolEnd(status === 'completed', text(item, 'aggregatedOutput'));
        audit(id, COMMAND_TOOL, command, status);
      }
      break;
    }
    case 'fileChange': {
      const changes: readonly Record<string, unknown>[] = Array.isArray(item['changes'])
        ? (item['changes'] as readonly unknown[]).map(record)
        : [];
      const detail: string = changes
        .map(
          (change: Record<string, unknown>): string =>
            `${text(record(change['kind']), 'type', 'change')} ${text(change, 'path')}`,
        )
        .join(', ');
      if (!completed) {
        toolStart('Edit', detail);
      } else {
        toolEnd(status === 'completed');
        audit(id, EDIT_TOOL, detail, status);
      }
      break;
    }
    case 'mcpToolCall':
      if (!completed) {
        toolStart(`${text(item, 'server')} / ${text(item, 'tool')}`, text(item, 'tool'));
      } else {
        toolEnd(status === 'completed');
      }
      break;
    case 'webSearch':
      if (!completed) {
        toolStart('Web search', text(item, 'query'));
      } else {
        toolEnd(true);
      }
      break;
    case 'agentMessage':
      // Streamed as deltas; the completed item repeats the text, so nothing is emitted here.
      break;
    default:
      break;
  }
}

/**
 * Records an action that ran to Studio's audit log, with why it was allowed.
 * @param itemId The Codex item.
 * @param name The tool's display name.
 * @param detail What it did.
 * @param status How it ended; a declined action never ran and is not recorded.
 */
function audit(itemId: string, name: string, detail: string, status: string): void {
  if (running === null || status === 'declined') {
    return;
  }
  // An action that reached completion without ever asking ran inside the sandbox on Codex's own
  // judgement: under `never` because the posture allows everything, otherwise because Codex deems it
  // a safe read.
  const source: string =
    allowed.get(itemId) ??
    (running.turn.permissionPosture === 'auto-all' ? 'posture' : 'gated-or-auto');
  allowed.delete(itemId);
  send({ type: 'audit', requestId: running.turn.requestId, name, detail, source });
}

/**
 * Handles a notification from Codex.
 * @param method The method.
 * @param params The parameters.
 */
function onNotification(method: string, params: unknown): void {
  const body: Record<string, unknown> = record(params);
  if (running === null) {
    return;
  }
  const requestId: string = running.turn.requestId;
  switch (method) {
    case 'item/started':
      translateItem(record(body['item']), false);
      break;
    case 'item/completed':
      translateItem(record(body['item']), true);
      break;
    case 'item/agentMessage/delta':
      emit({ requestId, kind: 'text', delta: text(body, 'delta') });
      break;
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      emit({ requestId, kind: 'thinking', delta: text(body, 'delta') });
      break;
    case 'thread/tokenUsage/updated': {
      const usage: Record<string, unknown> = record(body['tokenUsage']);
      const last: Record<string, unknown> = record(usage['last']);
      running.usage = {
        inputTokens: typeof last['inputTokens'] === 'number' ? last['inputTokens'] : 0,
        outputTokens: typeof last['outputTokens'] === 'number' ? last['outputTokens'] : 0,
        contextWindow:
          typeof usage['modelContextWindow'] === 'number' ? usage['modelContextWindow'] : null,
      };
      break;
    }
    case 'error': {
      const failure: Record<string, unknown> = record(body['error']);
      if (body['willRetry'] !== true) {
        running.failure = text(failure, 'message', 'Codex reported an error.');
      }
      break;
    }
    case 'turn/completed': {
      const turn: Record<string, unknown> = record(body['turn']);
      if (running.turnId !== null && text(turn, 'id') !== running.turnId) {
        break;
      }
      const status: string = text(turn, 'status');
      if (status === 'failed') {
        const failure: Record<string, unknown> = record(turn['error']);
        running.failure ??= text(failure, 'message', 'Codex did not finish the turn.');
        running.done('failed');
      } else {
        // An interrupted turn is not a failure: Studio already knows it stopped the run.
        running.done('completed');
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Answers a request from Codex: an approval, a question for the user, or something this harness does
 * not offer.
 * @param method The method.
 * @param params The parameters.
 * @returns Returns the answer.
 */
async function onRequest(method: string, params: unknown): Promise<unknown> {
  const body: Record<string, unknown> = record(params);
  switch (method) {
    case 'item/commandExecution/requestApproval': {
      const decision: Decision =
        running === null ? refusedAfterTurn() : decideCommand(running.turn);
      const detail: string = text(body, 'command') || text(body, 'reason', 'a command');
      return { decision: await settleApproval(text(body, 'itemId'), decision, detail) };
    }
    case 'item/fileChange/requestApproval': {
      const decision: Decision =
        running === null ? refusedAfterTurn() : decideFileChange(running.turn);
      const detail: string = text(body, 'reason', 'file changes in the workspace');
      return { decision: await settleApproval(text(body, 'itemId'), decision, detail) };
    }
    case 'item/permissions/requestApproval': {
      const decision: Decision = decidePermissions();
      note(`declined a permissions request: ${decision.kind === 'decline' ? decision.reason : ''}`);
      // Grants nothing: an empty profile for this turn only.
      return { permissions: {}, scope: 'turn' };
    }
    case 'item/tool/requestUserInput':
      return answerQuestions(body);
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null };
    default:
      throw new Error(`${method} is not something this harness answers.`);
  }
}

/**
 * The decision for an approval that arrives with no turn running — after an abort, say.
 * @returns Returns a refusal.
 */
function refusedAfterTurn(): Decision {
  return { kind: 'decline', reason: 'The turn is no longer running.' };
}

/**
 * Carries a decision out: accepts, declines, or puts it to the user and does what they said.
 * @param itemId The Codex item, so the audit record can say why it ran.
 * @param decision The decision.
 * @param detail What the user is shown.
 * @returns Returns Codex's decision word.
 */
async function settleApproval(
  itemId: string,
  decision: Decision,
  detail: string,
): Promise<'accept' | 'decline'> {
  if (decision.kind === 'decline') {
    note(`declined: ${decision.reason}`);
    return 'decline';
  }
  if (decision.kind === 'accept') {
    allowed.set(itemId, auditSource(decision));
    return 'accept';
  }
  if (running === null) {
    return 'decline';
  }
  const answer: Answer = await ask(running.turn.requestId, {
    kind: 'permission',
    name: decision.tool,
    detail,
  });
  const granted: boolean = answer.kind === 'permission' && answer.granted;
  if (granted) {
    allowed.set(itemId, auditSource(decision));
  }
  return granted ? 'accept' : 'decline';
}

/**
 * Puts Codex's questions to the user one at a time, through Studio's input prompt.
 * @param body The request's parameters.
 * @returns Returns the answers, keyed by question id.
 */
async function answerQuestions(body: Record<string, unknown>): Promise<unknown> {
  const answers: Record<string, { answers: string[] }> = {};
  if (running === null) {
    return { answers };
  }
  const questions: readonly Record<string, unknown>[] = Array.isArray(body['questions'])
    ? (body['questions'] as readonly unknown[]).map(record)
    : [];
  for (const question of questions) {
    const options: readonly Record<string, unknown>[] = Array.isArray(question['options'])
      ? (question['options'] as readonly unknown[]).map(record)
      : [];
    const choices: string[] = options
      .map((option: Record<string, unknown>): string => text(option, 'label'))
      .filter((label: string): boolean => label.length > 0);
    const header: string = text(question, 'header');
    const asked: string = text(question, 'question');
    const answer: Answer = await ask(running.turn.requestId, {
      kind: 'input',
      question: header.length > 0 && !asked.startsWith(header) ? `${header}: ${asked}` : asked,
      choices,
    });
    const reply: string | null = answer.kind === 'input' ? answer.answer : null;
    answers[text(question, 'id')] = { answers: reply === null ? [] : [reply] };
  }
  return { answers };
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
          // Only `discover` (#866): the claude.ai bridge behind `remote-control` is Anthropic's, and
          // nothing here backgrounds work for `task.stop` to name.
          answers: ['discover'],
          images: false,
          efforts: ['low', 'medium', 'high', 'xhigh'],
          resumable: true,
          // Every window is `context_window` from the CLI's own list of the account's models.
          guaranteedContextWindows: true,
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
      abortTurn();
      break;
    case 'discover':
      void readCodexModels(codexHome()).then((found: CodexModels): void =>
        send({ type: 'models', discoveryId: message.discoveryId, ...found }),
      );
      break;
    case 'steer':
    case 'remote-control':
      // Both declined at the handshake, so Studio has already handled them.
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
lines.on('close', (): void => {
  codex.close();
  process.exit(0);
});
