import { setTimeout as sleep } from 'node:timers/promises';
import { LspDiagnosticsCoalescer } from '../../src/shared/electron/lsp/lsp-diagnostics-coalescer';
import { BenchCase } from './bench-case';

/**
 * Specifies how many bursts a server sends, five milliseconds apart.
 */
const BURSTS: number = 40;

/**
 * Specifies how many publishes each burst holds.
 */
const PUBLISHES_PER_BURST: number = 100;

/**
 * Specifies how many documents the publishes share: a server republishes a file as it re-analyses.
 */
const DOCUMENTS: number = 20;

/**
 * Generates one document's publish.
 * @param document The document's number.
 * @returns Returns the parameters.
 */
function publishOf(document: number): unknown {
  return {
    uri: `file:///workspace/src/file-${document}.ts`,
    diagnostics: Array.from({ length: 20 }, (_unused: unknown, line: number): unknown => ({
      message: `Type 'string' is not assignable to type 'number' on line ${line}.`,
      severity: 1,
      range: { start: { line, character: 0 }, end: { line, character: 40 } },
    })),
  };
}

const publishes: readonly unknown[] = Array.from(
  { length: DOCUMENTS },
  (_unused: unknown, document: number): unknown => publishOf(document),
);

/**
 * Holds the notes, by case.
 */
const notes: Map<string, string> = new Map<string, string>();

/**
 * Plays the bursts through a send that structured-clones, as IPC does.
 * @param name The case.
 * @param coalesced Whether the coalescer is in the path.
 * @returns Returns how many sends there were.
 */
async function play(name: string, coalesced: boolean): Promise<number> {
  let sends: number = 0;
  let cloneMs: number = 0;
  const send: (sessionId: string, method: string, params: unknown) => void = (
    _sessionId: string,
    _method: string,
    params: unknown,
  ): void => {
    const started: number = performance.now();
    structuredClone(params);
    cloneMs += performance.now() - started;
    sends += 1;
  };
  const coalescer: LspDiagnosticsCoalescer = new LspDiagnosticsCoalescer(send);
  for (let burst: number = 0; burst < BURSTS; burst += 1) {
    for (let publish: number = 0; publish < PUBLISHES_PER_BURST; publish += 1) {
      const params: unknown = publishes[publish % DOCUMENTS];
      if (coalesced) {
        coalescer.publish('session', params);
      } else {
        send('session', 'textDocument/publishDiagnostics', params);
      }
    }
    await sleep(5);
  }
  coalescer.flush('session');
  notes.set(name, `${sends} sends, ${cloneMs.toFixed(1)} ms cloning`);
  return sends;
}

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'forward every publish',
    run: async (): Promise<number> => play('direct', false),
    note: (): string => notes.get('direct') ?? '',
  },
  {
    name: 'coalesce per uri',
    run: async (): Promise<number> => play('coalesced', true),
    note: (): string => notes.get('coalesced') ?? '',
  },
];
