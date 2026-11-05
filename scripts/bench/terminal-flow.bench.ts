import {
  LOW_WATERMARK,
  TerminalFlowControl,
} from '../../src/shared/electron/terminal-flow-control';
import { BenchCase } from './bench-case';

/**
 * Specifies the characters the PTY delivers per tick while it is flowing.
 */
const PRODUCED_PER_TICK: number = 64 * 1024;

/**
 * Specifies the characters the renderer parses per tick: a quarter of the rate `yes` can produce.
 */
const PARSED_PER_TICK: number = 16 * 1024;

/**
 * Specifies how many ticks the flood lasts.
 */
const TICKS: number = 4096;

/**
 * Holds the largest backlog of each case, in characters, for its note.
 */
const peaks: Map<string, number> = new Map<string, number>();

/**
 * Plays a flood through a modelled pipeline, since a real PTY and renderer are not available in plain
 * node. The model is the point: what is measured is how far the backlog between them can grow.
 * @param name The case.
 * @param controlled Whether flow control is in the path.
 * @returns Returns the largest backlog.
 */
function flood(name: string, controlled: boolean): number {
  let paused: boolean = false;
  let backlog: number = 0;
  let peak: number = 0;
  const flow: TerminalFlowControl = new TerminalFlowControl();
  flow.track('t', {
    pause: (): void => {
      paused = true;
    },
    resume: (): void => {
      paused = false;
    },
  });
  flow.acknowledge('t', 0);
  for (let tick: number = 0; tick < TICKS; tick += 1) {
    if (!paused) {
      backlog += PRODUCED_PER_TICK;
      if (controlled) {
        flow.sent('t', PRODUCED_PER_TICK);
      }
    }
    peak = Math.max(peak, backlog);
    const parsed: number = Math.min(backlog, PARSED_PER_TICK);
    backlog -= parsed;
    if (controlled) {
      flow.acknowledge('t', parsed);
    }
  }
  flow.forget('t');
  peaks.set(name, peak);
  return peak;
}

/**
 * Describes a case's peak backlog.
 * @param name The case.
 * @returns Returns the note.
 */
function peakOf(name: string): string {
  const megabytes: number = (peaks.get(name) ?? 0) / (1024 * 1024);
  return `peak backlog ${megabytes.toFixed(1)} MB, low watermark ${LOW_WATERMARK / 1024} KB`;
}

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'flood without flow control',
    run: (): number => flood('uncontrolled', false),
    note: (): string => peakOf('uncontrolled'),
  },
  {
    name: 'flood with flow control',
    run: (): number => flood('controlled', true),
    note: (): string => peakOf('controlled'),
  },
];
