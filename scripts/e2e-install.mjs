#!/usr/bin/env node
// The install gate's Linux runs (#1546): builds this branch's Linux installer, installs it on a clean
// Linux machine that has every toolchain the plugins drive, completes a full first-run setup against
// the real plugin index, restarts, and reports what happened to each plugin.
//
// Everything runs in Docker. The host builds nothing it would run: the installer is built in a Linux
// container, as release.yml builds it on its Linux runner, and Studio is installed and launched only
// inside the gate's own container. Nothing is installed on, or launched from, this machine.
//
//   npm run e2e:install                        Debian, building the installer first
//   npm run e2e:install -- --distro fedora     another distribution (debian, fedora)
//   npm run e2e:install -- --distro all        every distribution, one after the other
//   npm run e2e:install -- --reuse-installer   skip the build, using the AppImage already in release/
//   npm run e2e:install -- --installer <file>  skip the build, using that AppImage — what CI does, with
//                                              the one its build job made
//
// Evidence — Studio's logs, a listing of the plugin install folder, screenshots, the summary — lands
// in e2e/install/output/<distro>/, which the container writes to. The macOS and Windows legs run the
// same test on GitHub's runners; see .github/workflows/install-gate.yml.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { report } from './e2e-install-report.mjs';

// Anchored to this file, so it runs the same from any working directory.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_VERSION = readFileSync(join(REPO, '.nvmrc'), 'utf8').trim();
const DISTROS = ['debian', 'fedora'];

// The builder's node_modules, and the caches electron-builder fills, live in volumes of their own:
// node-pty is compiled for the platform it runs on, so the host's macOS install cannot be used, and
// the gate's volumes are kept apart from `npm run e2e:docker`'s so neither run disturbs the other.
const MODULES = 'onixlabs-studio-e2e-install-node-modules';
const CACHE = 'onixlabs-studio-e2e-install-cache';

/**
 * Reads the command-line options.
 * @returns {{ distros: string[], reuseInstaller: boolean, installer: string | undefined, playwright: string[] }}
 * Returns the options.
 */
function options() {
  const args = argv.slice(2);
  let distros = ['debian'];
  let reuseInstaller = false;
  let installer;
  const playwright = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--distro') {
      const value = args[(index += 1)];
      distros = value === 'all' ? DISTROS : [value];
    } else if (arg === '--reuse-installer') {
      reuseInstaller = true;
    } else if (arg === '--installer') {
      installer = resolve(args[(index += 1)]);
    } else {
      playwright.push(arg);
    }
  }
  for (const distro of distros) {
    if (!DISTROS.includes(distro)) {
      console.error(`Unknown distribution '${distro}'. Choose one of: ${DISTROS.join(', ')}, all.`);
      exit(2);
    }
  }
  return { distros, reuseInstaller, installer, playwright };
}

/**
 * Runs a command, showing its output.
 * @param {string} command The program.
 * @param {readonly string[]} args Its arguments.
 * @returns {number} Returns its exit status.
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'inherit' });
  return result.status ?? 1;
}

/**
 * Runs a command and stops this script when it fails.
 * @param {string} what What the step is, for the failure message.
 * @param {string} command The program.
 * @param {readonly string[]} args Its arguments.
 */
function step(what, command, args) {
  console.log(`\n▶ ${what}`);
  const status = run(command, args);
  if (status !== 0) {
    console.error(`\n✖ ${what} failed (exit ${status}).`);
    exit(status);
  }
}

/**
 * Finds the AppImage the last build wrote.
 * @returns {string | undefined} Returns its path, or undefined when there is none.
 */
function builtInstaller() {
  const release = join(REPO, 'release');
  if (!existsSync(release)) {
    return undefined;
  }
  const newest = readdirSync(release)
    .filter((name) => name.endsWith('.AppImage'))
    .sort(
      (left, right) =>
        statSync(join(release, right)).mtimeMs - statSync(join(release, left)).mtimeMs,
    )[0];
  return newest === undefined ? undefined : join(release, newest);
}

/**
 * Builds the Linux installer exactly as release.yml's Linux target does: scripts/package-linux.mjs,
 * unsigned, in Debian 12. The container's node_modules and caches are kept in volumes of their own.
 */
function buildInstaller() {
  rmSync(join(REPO, 'release'), { recursive: true, force: true });
  step('Build the Linux installer (as release.yml does)', 'node', [
    join(REPO, 'scripts', 'package-linux.mjs'),
    '--modules',
    MODULES,
    '--cache',
    CACHE,
  ]);
}

/**
 * Builds a distribution's gate image.
 * @param {string} distro The distribution.
 */
function buildImage(distro) {
  step(`Build the ${distro} image (toolchains installed first)`, 'docker', [
    'build',
    '--platform',
    'linux/amd64',
    '--build-arg',
    `NODE_VERSION=${NODE_VERSION}`,
    '--file',
    join(REPO, 'e2e', 'install', `${distro}.Dockerfile`),
    '--tag',
    `onixlabs-studio-install-${distro}`,
    join(REPO, 'e2e', 'install'),
  ]);
}

/**
 * Runs the gate in a fresh container of a distribution's image.
 * @param {string} distro The distribution.
 * @param {string} installer The AppImage.
 * @param {readonly string[]} playwright Extra arguments for Playwright.
 * @returns {number} Returns Playwright's exit status.
 */
function runGate(distro, installer, playwright) {
  const output = join(REPO, 'e2e', 'install', 'output', distro);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  // The container's user is not necessarily the host's (a CI runner's is uid 1001, the image's
  // 1000), and it has to be able to write the evidence.
  chmodSync(output, 0o777);
  // On a Linux host the checkout's own node_modules is already Linux's, and the harness needs only
  // Playwright from it; anywhere else the builder's volume stands in.
  const modules =
    process.platform === 'linux' && existsSync(join(REPO, 'node_modules', '@playwright', 'test'))
      ? []
      : ['--volume', `${MODULES}:/work/node_modules:ro`];
  console.log(`\n▶ Install and set up Studio on ${distro}`);
  return run('docker', [
    'run',
    '--rm',
    '--init',
    '--platform',
    'linux/amd64',
    '--name',
    `onixlabs-studio-install-${distro}-${Date.now()}`,
    // Chromium uses shared memory for its renderers; Docker's 64 MB default crashes them.
    '--shm-size=2g',
    // The harness — Playwright and the test — comes from the repository, read-only. Studio itself is
    // only ever the installed copy.
    '--volume',
    `${REPO}:/work:ro`,
    ...modules,
    '--volume',
    `${dirname(installer)}:/installers:ro`,
    '--volume',
    `${output}:/output`,
    '--env',
    `STUDIO_GATE_INSTALLER=/installers/${basename(installer)}`,
    '--env',
    'STUDIO_GATE_OUTPUT=/output',
    '--env',
    `STUDIO_GATE_DISTRO=${distro}`,
    '--env',
    'CI=true',
    '--workdir',
    '/work',
    `onixlabs-studio-install-${distro}`,
    'xvfb-run',
    '--auto-servernum',
    '--server-args=-screen 0 1600x1000x24',
    '--',
    'node',
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'e2e/install/playwright.config.ts',
    ...playwright,
  ]);
}

try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
} catch {
  console.error(
    'Docker is not running. Start Docker Desktop (or the Docker engine) and try again.',
  );
  exit(1);
}

const { distros, reuseInstaller, installer: given, playwright } = options();
const started = Date.now();
if (given === undefined && (!reuseInstaller || builtInstaller() === undefined)) {
  buildInstaller();
}
const installer = given ?? builtInstaller();
if (installer === undefined || !existsSync(installer)) {
  console.error(`No AppImage to install: ${installer ?? 'the build wrote none to release/'}.`);
  exit(1);
}
console.log(`\nInstaller: ${installer}`);

const results = [];
for (const distro of distros) {
  buildImage(distro);
  results.push([distro, runGate(distro, installer, playwright)]);
}
for (const [distro, status] of results) {
  report(distro, join(REPO, 'e2e', 'install', 'output', distro, 'summary.json'), status);
  console.log(`  Evidence: e2e/install/output/${distro}/`);
}
console.log(`\nTotal ${Math.round((Date.now() - started) / 60000)} min.`);
exit(results.some(([, status]) => status !== 0) ? 1 : 0);
