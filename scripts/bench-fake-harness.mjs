#!/usr/bin/env node
// A benchmark's agent harness: `e2e/fake-live-harness.mjs` with the prompts a long transcript needs.
//
// The live-session counterpart to `src/shared/electron/ai/testing/echo-harness.mjs`, and like it this
// imports nothing: it reads JSON lines on stdin and writes JSON lines on stdout. No real harness can
// run in CI — each needs a model provider and a credential — so this stands in for one wherever a
// suite needs a process Studio holds open across turns.
//
// Its behaviour is driven by the prompt:
//
//   - `hold <ms>` — keeps the turn running for that long before finishing, so a suite can act while a
//                   turn is in progress.
//   - `partial <text>` — streams the text a word at a time, then waits for Stop, so a suite can see
//                   output arrive while the turn is still running.
//   - `pid`       — reports its process id, then waits, so a suite can kill it mid-turn.
//   - `stubborn`  — ignores Stop, the way a wedged harness would, and never finishes.
//   - `flood <tools> <subagents> [perBurst] [burstMs]` — emits a transcript of `<tools>` tool calls with
//                   text and thinking between them, `<subagents>` of the calls being sub-agents with
//                   their own nested calls, at `perBurst` events every `burstMs` milliseconds.
//   - `lane <children> <everyMs>` — opens one sub-agent and adds a nested call every `everyMs`, so a
//                   lane can be watched as it updates.
//   - anything else — echoes the prompt back and finishes at once.
//
// While a file named `hold-ready` sits beside this script the handshake waits for it to go, which lets a
// suite act in the window a real harness spends starting up, without racing it.

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * The protocol version this harness speaks. Declared, not imported: the contract is the wire.
 */
const PROTOCOL_VERSION = '1.11.0';

/**
 * Writes one protocol message to Studio.
 * @param {object} message The message to send.
 */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Holds what ends each turn that is waiting to be stopped, by run.
 * @type {Map<string, () => void>}
 */
const stoppable = new Map();

/**
 * Waits for Studio to stop a turn.
 * @param {string} requestId The run.
 * @returns {Promise<void>} Resolves when the turn is aborted.
 */
function untilStopped(requestId) {
  return new Promise((resolve) => stoppable.set(requestId, resolve));
}

/**
 * Emits one event of a run.
 * @param {string} requestId The run.
 * @param {object} event The event.
 */
function emit(requestId, event) {
  send({ type: 'event', event: { requestId, ...event } });
}

/**
 * Emits a finished tool call.
 * @param {string} requestId The run.
 * @param {string} toolId The tool call's identifier.
 * @param {number} index The call's number, which varies its content.
 * @param {string} [parentToolId] The sub-agent the call belongs to, if any.
 */
function emitTool(requestId, toolId, index, parentToolId) {
  const nesting = parentToolId === undefined ? {} : { parentToolId };
  const file = `src/area-${index % 40}/module-${index % 400}/file-${index}.ts`;
  emit(requestId, {
    kind: 'tool-start',
    toolId,
    name: index % 3 === 0 ? 'Bash' : 'Read',
    detail: file,
    input: JSON.stringify({ file_path: file, limit: 200 }),
    ...nesting,
  });
  emit(requestId, {
    kind: 'tool-end',
    toolId,
    ok: true,
    detail: `read ${index % 200} lines`,
    output: `export const value${index} = ${index};\n`.repeat(8),
    ...nesting,
  });
}

/**
 * Emits a long transcript.
 * @param {string} requestId The run.
 * @param {number} tools How many tool calls it holds.
 * @param {number} subagents How many of them are sub-agents.
 * @param {number} perBurst How many events go out together.
 * @param {number} burstMs How long to leave between bursts.
 * @returns {Promise<void>} Resolves when it has all been sent.
 */
async function emitFlood(requestId, tools, subagents, perBurst, burstMs) {
  const every = subagents === 0 ? Infinity : Math.floor(tools / subagents);
  let sent = 0;
  const pace = async (count) => {
    sent += count;
    if (sent >= perBurst) {
      sent = 0;
      await new Promise((resolve) => setTimeout(resolve, burstMs));
    }
  };
  for (let index = 0; index < tools; index += 1) {
    if (index % 8 === 0) {
      emit(requestId, { kind: 'thinking', delta: `Considering step ${index} of the plan. ` });
      emit(requestId, {
        kind: 'text',
        delta: `Working through **item ${index}**, which touches \`file-${index}.ts\`.\n\n`,
      });
      await pace(2);
    }
    if (index % every === every - 1) {
      const lane = `lane-${index}`;
      emit(requestId, {
        kind: 'tool-start',
        toolId: lane,
        name: 'Task',
        detail: `Explore area ${index}`,
        agentType: 'Explore',
      });
      for (let child = 0; child < 25; child += 1) {
        emitTool(requestId, `${lane}-${child}`, child, lane);
        await pace(2);
      }
      emit(requestId, { kind: 'tool-end', toolId: lane, ok: true, detail: 'done' });
      await pace(2);
    } else {
      emitTool(requestId, `tool-${index}`, index);
      await pace(2);
    }
  }
}

/**
 * Emits one sub-agent that grows slowly.
 * @param {string} requestId The run.
 * @param {number} children How many nested calls it makes.
 * @param {number} everyMs How long to leave between them.
 * @returns {Promise<void>} Resolves once the sub-agent finishes.
 */
async function emitLane(requestId, children, everyMs) {
  emit(requestId, {
    kind: 'tool-start',
    toolId: 'lane',
    name: 'Task',
    detail: 'Explore the code',
    agentType: 'Explore',
  });
  for (let child = 0; child < children; child += 1) {
    emitTool(requestId, `lane-child-${child}`, child, 'lane');
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  emit(requestId, { kind: 'tool-end', toolId: 'lane', ok: true, detail: 'done' });
}

/**
 * Runs one turn.
 * @param {{ requestId: string, prompt: string }} turn The turn envelope.
 */
async function runTurn(turn) {
  const { requestId, prompt } = turn;
  send({ type: 'event', event: { requestId, kind: 'session', sessionId: 'fake-live-session' } });
  const say = (delta) => send({ type: 'event', event: { requestId, kind: 'text', delta } });
  const partial = /^partial (.+)$/.exec(prompt);
  if (partial !== null) {
    for (const word of partial[1].split(' ')) {
      say(`${word} `);
    }
    await untilStopped(requestId);
    send({ type: 'turn.completed', requestId, sessionId: 'fake-live-session' });
    return;
  }
  const flood = /^flood (\d+) (\d+)(?: (\d+) (\d+))?$/.exec(prompt);
  if (flood !== null) {
    await emitFlood(
      requestId,
      Number(flood[1]),
      Number(flood[2]),
      Number(flood[3] ?? 100),
      Number(flood[4] ?? 16),
    );
    send({ type: 'turn.completed', requestId, sessionId: 'fake-live-session' });
    return;
  }
  const lane = /^lane (\d+) (\d+)$/.exec(prompt);
  if (lane !== null) {
    await emitLane(requestId, Number(lane[1]), Number(lane[2]));
    send({ type: 'turn.completed', requestId, sessionId: 'fake-live-session' });
    return;
  }
  if (prompt === 'pid') {
    say(`pid:${process.pid}:`);
    await untilStopped(requestId);
    send({ type: 'turn.completed', requestId, sessionId: 'fake-live-session' });
    return;
  }
  if (prompt === 'stubborn') {
    say('not stopping');
    return;
  }
  const hold = /^hold (\d+)$/.exec(prompt);
  if (hold !== null) {
    await new Promise((resolve) => setTimeout(resolve, Number(hold[1])));
  }
  send({ type: 'event', event: { requestId, kind: 'text', delta: `echo: ${prompt}` } });
  send({ type: 'turn.completed', requestId, sessionId: 'fake-live-session' });
}

/**
 * Completes the handshake, once nothing is holding it back.
 */
function announceReady() {
  if (existsSync(new URL('./hold-ready', import.meta.url))) {
    setTimeout(announceReady, 10);
    return;
  }
  send({
    type: 'ready',
    capabilities: {
      protocolVersion: PROTOCOL_VERSION,
      sessionModel: 'live-harness',
      answers: [],
      images: false,
      efforts: [],
      resumable: false,
    },
  });
}

/**
 * Handles one message from Studio.
 * @param {{ type: string, turn?: object }} message The message.
 */
function receive(message) {
  switch (message.type) {
    case 'initialize':
      announceReady();
      break;
    case 'turn.start':
      void runTurn(message.turn);
      break;
    case 'turn.abort':
      stoppable.get(message.requestId)?.();
      stoppable.delete(message.requestId);
      break;
    default:
      // A message this harness does not know is ignored rather than guessed at.
      break;
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  try {
    receive(JSON.parse(line));
  } catch {
    // Not JSON, so not a message. Studio never sends one; ignore it rather than dying.
  }
});
// End of input is Studio closing the pipe, which is how a harness is asked to stop.
lines.on('close', () => process.exit(0));
