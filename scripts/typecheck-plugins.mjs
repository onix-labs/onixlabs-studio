#!/usr/bin/env node
// Typechecks every plugin's TypeScript.
//
// Nothing else does. `build:electron` typechecks `src/shared/electron` and each plugin's `build.mjs`
// runs esbuild, which **strips types without checking them** — so a plugin with a type error builds
// clean, packs clean, publishes clean, and fails on a user's machine at the first turn.
//
// The gap was invisible while the plugins were small and hand-run. It stops being invisible the moment
// a plugin is a provider somebody's agent depends on.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

// Anchored to this file rather than the working directory, for the same reason the pack script is.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = join(REPO, 'plugins');

const projects = readdirSync(PLUGINS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(PLUGINS, entry.name, 'tsconfig.json'))
  .filter((path) => existsSync(path));

stdout.write(`Typechecking ${projects.length} plugin project(s)\n`);

let failures = 0;
for (const project of projects) {
  const name = project.slice(PLUGINS.length + 1).replace('/tsconfig.json', '');
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', project], { stdio: 'inherit', cwd: REPO });
    stdout.write(`  ok   ${name}\n`);
  } catch {
    // The compiler has already printed what is wrong; this only counts it, so one broken plugin does
    // not hide the next one's errors.
    failures += 1;
    stdout.write(`  FAIL ${name}\n`);
  }
}

stdout.write(
  failures === 0
    ? `\nAll ${projects.length} plugin project(s) typecheck.\n`
    : `\n${failures} of ${projects.length} plugin project(s) failed.\n`,
);
exit(failures === 0 ? 0 : 1);
