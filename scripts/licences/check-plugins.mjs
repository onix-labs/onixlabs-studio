#!/usr/bin/env node
// Builds every npm-tarball plugin, which writes and checks its licences (#1612), so a pull request
// that brings a plugin a dependency under a licence Studio cannot ship fails here, not on the release
// runner after the merge. A plugin's tarball is otherwise only built when its release is tagged.
//
//   node scripts/licences/check-plugins.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { exit, stdout } from 'node:process';
import { REPO } from './core.mjs';

const plugins = readdirSync(join(REPO, 'plugins'))
  .filter((name) => existsSync(join(REPO, 'plugins', name, 'package.json')))
  .sort();
const failed = [];
for (const name of plugins) {
  try {
    execFileSync('node', [join(REPO, 'plugins', name, 'build.mjs')], { stdio: 'pipe' });
  } catch (error) {
    failed.push(name);
    stdout.write(`\n${name}:\n${error.stderr?.toString() ?? error.message}\n`);
  }
}
stdout.write(`Checked the licences of ${plugins.length} plugins.\n`);
if (failed.length > 0) {
  stdout.write(`Failed: ${failed.join(', ')}\n`);
  exit(1);
}
