#!/usr/bin/env node
// Runs the end-to-end suite in a Linux container with a virtual display, as the CI job runs it, so a
// local run puts no window in front of the developer.
//
// The suite drives the real application, main process and all, so it cannot run in a headless
// browser; and Electron has no headless mode on macOS or Windows. On Linux it draws to Xvfb instead,
// which is what the CI job does. This does the same in Docker.
//
// The repository is mounted into the container. Its `node_modules` is not: the container keeps its
// own, in a Docker volume, because node-pty and Electron are built for the platform they run on. That
// install is redone only when `package-lock.json` changes.
//
//   npm run e2e:docker                      the whole suite
//   npm run e2e:docker -- trust -g clone    any arguments go to Playwright

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

// Anchored to this file, so it runs the same from any working directory.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = 'onixlabs-studio-e2e';
const MODULES = 'onixlabs-studio-e2e-node-modules';
const NODE_VERSION = readFileSync(join(REPO, '.nvmrc'), 'utf8').trim();

/**
 * Runs a command, showing its output, and stops this script when it fails.
 * @param {string} command The program.
 * @param {readonly string[]} args Its arguments.
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'inherit' });
  if (result.status !== 0) {
    exit(result.status ?? 1);
  }
}

/**
 * Quotes an argument for the container's shell.
 * @param {string} value The argument.
 * @returns {string} Returns it quoted.
 */
function quoted(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
} catch {
  console.error('Docker is not running. Start Docker Desktop (or the Docker engine) and try again.');
  exit(1);
}

run('docker', [
  'build',
  '--quiet',
  '--build-arg',
  `NODE_VERSION=${NODE_VERSION}`,
  '--tag',
  IMAGE,
  join(REPO, 'e2e', 'docker'),
]);

// The steps the CI job takes, in its order. The install is skipped while the lockfile it was made
// from is unchanged; `npm ci` rebuilds node-pty for Electron through the postinstall hook.
const steps = [
  'set -e',
  'stamp=node_modules/.e2e-docker-lock',
  'if ! cmp -s package-lock.json "$stamp"; then npm ci && cp package-lock.json "$stamp"; fi',
  'npx install-electron',
  'npm run build',
  'npm run build:electron',
  `xvfb-run --auto-servernum -- npm run e2e -- ${argv.slice(2).map(quoted).join(' ')}`,
].join('\n');

run('docker', [
  'run',
  '--rm',
  '--init',
  // Chromium uses shared memory for its renderers; Docker's 64 MB default crashes them.
  '--shm-size=2g',
  '--volume',
  `${REPO}:/work`,
  '--volume',
  `${MODULES}:/work/node_modules`,
  // As the CI job runs: the suite passes `--no-sandbox` to Electron, which cannot set up its
  // sandbox in a container, and retries a failed test once.
  '--env',
  'CI=true',
  IMAGE,
  'bash',
  '-c',
  steps,
]);
