#!/usr/bin/env node
// Runs the main-process benchmarks: `npm run bench`, or `npm run bench -- <filter> --iterations 10`.
//
// Each `scripts/bench/*.bench.ts` exports `cases: BenchCase[]`. It is bundled with esbuild (so a
// bench imports the real source), then run in its own plain node process with `--expose-gc`, and the
// median, p95 and heap growth are printed as a table followed by one JSON line per bench.
//
// Benchmarks generate their data, in memory or in a `mkdtemp` under os.tmpdir(), and remove it again.
// Nothing here reads a real profile. Results are printed and not saved: they belong to the machine
// that ran them, so a file of them in the repository would only ever be someone else's numbers.
// Compare two states of the code by running the same bench on each, on the same machine.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { iterations: { type: 'string', default: '5' } },
});
const iterations = Number(values.iterations);
const filter = positionals[0];

if (!Number.isInteger(iterations) || iterations < 1) {
  console.error('--iterations takes a positive whole number');
  process.exit(1);
}

const entries = readdirSync(here)
  .filter((name) => name.endsWith('.bench.ts'))
  .filter((name) => filter === undefined || name.includes(filter));

if (entries.length === 0) {
  console.error(`No bench matches '${filter}'`);
  process.exit(1);
}

const outdir = mkdtempSync(join(tmpdir(), 'studio-bench-'));
const failures = [];

try {
  for (const entry of entries) {
    const outfile = join(outdir, entry.replace(/\.ts$/, '.cjs'));
    await build({
      stdin: {
        contents: `
          import { cases } from './${entry}';
          import { runCases } from './run-cases';
          void runCases(cases, ${iterations});
        `,
        resolveDir: here,
        loader: 'ts',
      },
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      tsconfig: join(root, 'tsconfig.json'),
      alias: { electron: join(here, 'electron-stub.ts') },
      logLevel: 'warning',
    });

    // Run from the temp dir: a bench must not be able to lean on the working directory.
    const child = spawnSync(process.execPath, ['--expose-gc', outfile], {
      cwd: outdir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (child.status !== 0) {
      failures.push(entry);
      continue;
    }
    const results = JSON.parse(child.stdout.trim().split('\n').at(-1));
    console.log(`\n${entry}`);
    console.table(
      Object.fromEntries(
        results.map(({ name, iterations: runs, medianMs, p95Ms, heapDeltaMb, note }) => [
          name,
          { runs, 'median ms': medianMs, 'p95 ms': p95Ms, 'heap MB': heapDeltaMb, note },
        ]),
      ),
    );
    console.log(JSON.stringify({ bench: entry, results }));
  }
} finally {
  rmSync(outdir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
