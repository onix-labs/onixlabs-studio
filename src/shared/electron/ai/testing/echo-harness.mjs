#!/usr/bin/env node
// A reference agent harness, and the fixture the process transport is tested against.
//
// It exists to make two claims true rather than merely asserted:
//
//   1. **A harness needs no library to speak the protocol.** This file imports nothing — not from
//      Studio, not from npm. It reads JSON lines on stdin and writes JSON lines on stdout, which is
//      the whole contract. A third-party harness author has this as a worked example, and a
//      first-party one taking a shortcut into `src/` would quietly make itself unextractable.
//   2. **The transport actually works.** `HarnessProcess` spawns a real program, and until something
//      spawned one it was covered only by the type system.
//
// Its behaviour is driven by the prompt so a test can ask for a specific exchange:
//
//   - `ask`     — requests permission before finishing, and reports what it was answered.
//   - `input`   — asks the user a question, and reports the answer.
//   - `fail`    — fails the turn.
//   - `noise`   — writes a line to stderr and a non-JSON line to stdout before finishing, so the
//                 host's refusal paths are exercised against a real stream.
//   - anything else — echoes the prompt back as assistant text.

import { createInterface } from 'node:readline';

/**
 * The protocol version this harness speaks. Declared, not imported: the contract is the wire.
 */
const PROTOCOL_VERSION = '1.0.0';

/**
 * Writes one protocol message to Studio.
 * @param {object} message The message to send.
 */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Holds the run currently in flight, so a steer or an abort knows what it belongs to.
 * @type {string | null}
 */
let currentRun = null;

/**
 * Holds what to do with the answer to the question in flight, by call id.
 * @type {Map<string, (answer: object) => void>}
 */
const awaiting = new Map();

/**
 * Asks Studio a blocking question and resolves with its answer.
 * @param {string} requestId The run the question belongs to.
 * @param {object} request The question.
 * @returns {Promise<object>} Resolves with the answer.
 */
function ask(requestId, request) {
  const callId = `call-${awaiting.size + 1}`;
  return new Promise((resolve) => {
    awaiting.set(callId, resolve);
    send({ type: 'request', callId, requestId, request });
  });
}

/**
 * Emits a chunk of assistant text.
 * @param {string} requestId The run.
 * @param {string} delta The text.
 */
function say(requestId, delta) {
  send({ type: 'event', event: { requestId, kind: 'text', delta } });
}

/**
 * Runs one turn.
 * @param {object} turn The turn envelope.
 */
async function runTurn(turn) {
  const { requestId, prompt } = turn;
  currentRun = requestId;
  try {
    if (prompt === 'fail') {
      send({ type: 'turn.failed', requestId, error: 'the harness was asked to fail' });
      return;
    }
    if (prompt === 'noise') {
      process.stderr.write('a warning that is not a protocol message\n');
      process.stdout.write('this line is not JSON\n');
      say(requestId, 'survived the noise');
    } else if (prompt === 'ask') {
      const answer = await ask(requestId, {
        kind: 'permission',
        name: 'Echo',
        detail: 'say something',
      });
      say(requestId, answer.granted ? 'permitted' : 'refused');
    } else if (prompt === 'input') {
      const answer = await ask(requestId, {
        kind: 'input',
        question: 'what should I say?',
        choices: ['hello', 'goodbye'],
      });
      say(requestId, answer.answer ?? 'nothing');
    } else {
      say(requestId, `echo: ${prompt}`);
    }
    send({ type: 'audit', name: 'Echo', detail: prompt, source: 'posture' });
    send({ type: 'turn.completed', requestId, sessionId: 'echo-session' });
  } finally {
    currentRun = null;
  }
}

/**
 * Handles one message from Studio.
 * @param {object} message The message.
 */
function receive(message) {
  switch (message.type) {
    case 'initialize':
      send({
        type: 'ready',
        capabilities: {
          protocolVersion: PROTOCOL_VERSION,
          sessionModel: 'stateless',
          steering: true,
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
      const resolve = awaiting.get(message.callId);
      awaiting.delete(message.callId);
      resolve?.(message.answer);
      break;
    }
    case 'steer':
      say(message.requestId, `steered: ${message.text}`);
      break;
    case 'turn.abort':
      // Everything in flight is refused by Studio locally, so there is nothing to answer — just stop.
      if (currentRun !== null) {
        send({ type: 'turn.failed', requestId: currentRun, error: 'aborted' });
      }
      break;
    default:
      // A message this harness does not know is ignored rather than guessed at, which is the same
      // rule Studio applies in the other direction.
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
