#!/usr/bin/env node
// A test-only agent harness that holds a live session open, for the end-to-end suites.
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
//   - anything else — echoes the prompt back and finishes at once.

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
 * Runs one turn.
 * @param {{ requestId: string, prompt: string }} turn The turn envelope.
 */
async function runTurn(turn) {
  const { requestId, prompt } = turn;
  send({ type: 'event', event: { requestId, kind: 'session', sessionId: 'fake-live-session' } });
  const hold = /^hold (\d+)$/.exec(prompt);
  if (hold !== null) {
    await new Promise((resolve) => setTimeout(resolve, Number(hold[1])));
  }
  send({ type: 'event', event: { requestId, kind: 'text', delta: `echo: ${prompt}` } });
  send({ type: 'turn.completed', requestId, sessionId: 'fake-live-session' });
}

/**
 * Handles one message from Studio.
 * @param {{ type: string, turn?: object }} message The message.
 */
function receive(message) {
  switch (message.type) {
    case 'initialize':
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
      break;
    case 'turn.start':
      void runTurn(message.turn);
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
