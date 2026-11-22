#!/usr/bin/env node
// Prints the install gate's per-plugin summary (#1546): what `e2e/install/full-setup.install.ts` wrote
// to summary.json, one line per plugin with the reason for anything that did not pass. On GitHub
// Actions the same table is added to the job's step summary, so the result reads on the run's page.
//
//   node scripts/e2e-install-report.mjs <summary.json> <label> [<exit status>]
//
// `scripts/e2e-install.mjs` uses it for each container run; the macOS and Windows legs of
// .github/workflows/install-gate.yml call it directly.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Prints a run's summary.
 * @param {string} label The machine the run was on.
 * @param {string} file The summary.json the run wrote.
 * @param {number} status The test's exit status.
 */
export function report(label, file, status) {
  const verdict = status === 0 ? 'PASS' : 'FAIL';
  console.log(`\n━━ ${label}: ${verdict} ━━`);
  const markdown = [`### Install gate · ${label}: ${verdict}`, ''];
  if (!existsSync(file)) {
    const line = 'No summary was written: the run stopped before setup. See the test output.';
    console.log(`  ${line}`);
    markdown.push(line);
    writeStepSummary(markdown);
    return;
  }
  const summary = JSON.parse(readFileSync(file, 'utf8'));
  const width = Math.max(...summary.plugins.map((plugin) => plugin.id.length), 10);
  markdown.push('| | Plugin | Outcome | Reason |', '|---|---|---|---|');
  for (const plugin of summary.plugins) {
    const mark = plugin.outcome === 'pass' ? '✔' : plugin.outcome === 'skipped' ? '–' : '✖';
    const why = plugin.reason ? `  ${plugin.reason}` : '';
    console.log(`  ${mark} ${plugin.id.padEnd(width)}  ${plugin.outcome.padEnd(7)}${why}`);
    markdown.push(
      `| ${mark} | ${plugin.id} | ${plugin.outcome} | ${(plugin.reason ?? '').replaceAll('|', '\\|')} |`,
    );
  }
  if ((summary.findings ?? []).length > 0) {
    markdown.push('', '**Findings**', '');
  }
  for (const finding of summary.findings ?? []) {
    console.log(`  ! ${finding}`);
    markdown.push(`- ${finding}`);
  }
  const counts = summary.plugins.reduce((tally, plugin) => {
    tally[plugin.outcome] = (tally[plugin.outcome] ?? 0) + 1;
    return tally;
  }, {});
  const totals = `${Object.entries(counts)
    .map(([outcome, count]) => `${count} ${outcome}`)
    .join(
      ', ',
    )}; setup took ${Math.round((summary.setupSeconds ?? 0) / 60)} min, the run ${Math.round(
    (summary.totalSeconds ?? 0) / 60,
  )} min.`;
  console.log(`  ${totals}`);
  markdown.push('', totals);
  writeStepSummary(markdown);
}

/**
 * Adds lines to the GitHub Actions step summary, when there is one.
 * @param {readonly string[]} lines The markdown.
 */
function writeStepSummary(lines) {
  if (env.GITHUB_STEP_SUMMARY !== undefined) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
  }
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const [file, label, status] = argv.slice(2);
  if (file === undefined || label === undefined) {
    console.error('Usage: node scripts/e2e-install-report.mjs <summary.json> <label> [<status>]');
    exit(2);
  }
  report(label, file, Number(status ?? 0));
}
