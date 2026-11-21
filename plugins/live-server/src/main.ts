// The Live Server plugin's entry point (#1062).
//
// Started by Studio, it serves the live-server protocol on its standard streams: each line on stdin is
// one request, and each answer goes back as one line on stdout carrying the request's `id`.
//
// ⚠️ stdout carries the protocol and nothing else: a stray line on it is a response Studio refuses as
// malformed. Diagnostics go to stderr, which Studio records in its log.
import { createInterface, Interface } from 'node:readline';
import { LiveSites } from './live-sites';

const sites: LiveSites = new LiveSites();

/**
 * Writes one message to Studio.
 * @param message The message.
 */
function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Answers one line from Studio.
 * @param line The line.
 * @returns Returns a promise that resolves once it is answered.
 */
async function handle(line: string): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write('Ignored a line that is not JSON\n');
    return;
  }
  if (typeof message !== 'object' || message === null) {
    return;
  }
  const record: Record<string, unknown> = message as Record<string, unknown>;
  const id: unknown = record['id'];
  const op: unknown = record['op'];
  if (typeof id !== 'number' || typeof op !== 'string') {
    process.stderr.write('Ignored a request with no id or operation\n');
    return;
  }
  const params: Record<string, unknown> =
    typeof record['params'] === 'object' && record['params'] !== null
      ? (record['params'] as Record<string, unknown>)
      : {};
  try {
    send({ id, ok: true, result: await sites.answer(op, params) });
  } catch (error: unknown) {
    send({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Frees every port, then exits.
 * @returns Returns a promise that never settles in practice: the process exits.
 */
async function shutDown(): Promise<void> {
  try {
    await sites.closeAll();
  } finally {
    process.exit(0);
  }
}

const lines: Interface = createInterface({ input: process.stdin });
lines.on('line', (line: string): void => {
  if (line.trim().length > 0) {
    void handle(line);
  }
});
// Studio closing stdin is how it says the session is over: every port is freed before exiting.
lines.on('close', (): void => {
  void shutDown();
});
