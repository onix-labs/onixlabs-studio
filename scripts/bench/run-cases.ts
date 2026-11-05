import { BenchCase } from './bench-case';
import { BenchResult } from './bench-result';

/**
 * Specifies how many digits a measurement keeps.
 */
const DECIMALS: number = 2;

/**
 * Holds the latest iteration's result, so it is still alive when the heap is read.
 */
const held: unknown[] = [];

/**
 * Rounds a measurement to the digits worth reading.
 * @param value The measurement.
 * @returns Returns the rounded measurement.
 */
function round(value: number): number {
  return Number(value.toFixed(DECIMALS));
}

/**
 * Reads a percentile from sorted samples, by nearest rank.
 * @param sorted The samples, ascending.
 * @param fraction The percentile, from 0 to 1.
 * @returns Returns the sample at that rank.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  const rank: number = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, rank)] ?? 0;
}

/**
 * Collects garbage when node exposes it, so one iteration does not pay for the last.
 */
function collect(): void {
  globalThis.gc?.();
}

/**
 * Measures one case.
 * @param benchCase The case.
 * @param iterations The iterations asked for.
 * @returns Returns the measurements.
 */
async function measure(benchCase: BenchCase, iterations: number): Promise<BenchResult> {
  const count: number = Math.min(iterations, benchCase.maxIterations ?? iterations);
  const durations: number[] = [];
  const heapDeltas: number[] = [];
  await benchCase.setup?.();
  try {
    for (let iteration: number = 0; iteration < count; iteration += 1) {
      collect();
      const heapBefore: number = process.memoryUsage().heapUsed;
      const started: number = performance.now();
      held[0] = await benchCase.run();
      durations.push(performance.now() - started);
      heapDeltas.push(process.memoryUsage().heapUsed - heapBefore);
    }
  } finally {
    held.length = 0;
    await benchCase.teardown?.();
  }
  durations.sort((left: number, right: number): number => left - right);
  heapDeltas.sort((left: number, right: number): number => left - right);
  return {
    name: benchCase.name,
    iterations: count,
    medianMs: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    heapDeltaMb: round(percentile(heapDeltas, 0.5) / (1024 * 1024)),
    note: benchCase.note?.() ?? '',
  };
}

/**
 * Runs a benchmark's cases one after another and writes the results to stdout as JSON, which is how
 * the runner hears them.
 * @param cases The cases.
 * @param iterations The iterations for each.
 */
export async function runCases(cases: readonly BenchCase[], iterations: number): Promise<void> {
  const results: BenchResult[] = [];
  for (const benchCase of cases) {
    results.push(await measure(benchCase, iterations));
  }
  process.stdout.write(`${JSON.stringify(results)}\n`);
}
