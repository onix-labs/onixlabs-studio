#!/usr/bin/env node
// Asks a Roslyn C# language server what it offers, and checks each feature with a real request.
//
// A thin wrapper over `probe-lsp.mjs --server csharp` (#1203), kept so the Roslyn release recipe reads
// as it always has: it opens a real solution, waits for the load to finish, then exercises every
// feature epic #1139 builds on — and Roslyn's own: an injected unused local for fix-all, and
// `_vs_onAutoInsert`. It writes the whole answer to a JSON file, so two server versions can be diffed
// (#1140).
//
// Not part of any gate: it needs a .NET SDK, an installed server and a solution to load. Run it when
// moving the Roslyn pin, or before building a feature that depends on what the server does.
//
// ⚠️ Run it outside the agent sandbox: inside it the server answers `initialize` but the solution load
// never completes (the MSBuild build host cannot be reached; see #1163).
//
//   node scripts/probe-roslyn.mjs --solution ~/src/app/app.slnx
//   node scripts/probe-roslyn.mjs --solution app.slnx --file src/Program.cs --server <path> --out x.json
//   node scripts/probe-roslyn.mjs --solution app.slnx --verbose      # print the server's errors

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Reads a `--name value` argument.
 * @param {string} name The argument name, without dashes.
 * @returns {string | null} Returns its value, or null when absent.
 */
function option(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 || index + 1 >= argv.length ? null : argv[index + 1];
}

const solution = option('solution');
if (solution === null) {
  console.error(
    'Usage: node scripts/probe-roslyn.mjs --solution <path.sln|path.slnx> [--file <path.cs>] [--server <path>] [--out <file.json>] [--verbose]',
  );
  exit(2);
}
const args = [
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'probe-lsp.mjs'),
  '--server',
  'csharp',
  '--workspace',
  path.dirname(path.resolve(solution)),
  '--solution',
  path.resolve(solution),
  '--out',
  path.resolve(option('out') ?? path.join('.cache', 'roslyn-probe', 'capabilities.json')),
  // The solution load is slow on a large solution; wait as long as this probe always has.
  '--settle',
  '300',
];
if (option('file') !== null) args.push('--file', path.resolve(option('file')));
if (option('server') !== null) args.push('--server-path', path.resolve(option('server')));
if (argv.includes('--verbose')) args.push('--errors');
exit(spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1);
