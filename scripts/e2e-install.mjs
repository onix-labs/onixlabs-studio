#!/usr/bin/env node
// The install gate, run locally (#1546): builds this branch's Linux installer, installs it on a clean
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
//
// Evidence — Studio's logs, a listing of the plugin install folder, screenshots, the summary — lands
// in e2e/install/output/<distro>/, which the container writes to.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

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
 * @returns {{ distros: string[], reuseInstaller: boolean, playwright: string[] }} Returns the options.
 */
function options() {
  const args = argv.slice(2);
  let distros = ['debian'];
  let reuseInstaller = false;
  const playwright = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--distro') {
      const value = args[(index += 1)];
      distros = value === 'all' ? DISTROS : [value];
    } else if (arg === '--reuse-installer') {
      reuseInstaller = true;
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
  return { distros, reuseInstaller, playwright };
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
 * @returns {string | undefined} Returns its file name in release/, or undefined when there is none.
 */
function builtInstaller() {
  const release = join(REPO, 'release');
  if (!existsSync(release)) {
    return undefined;
  }
  return readdirSync(release)
    .filter((name) => name.endsWith('-linux-x86_64.AppImage') || name.endsWith('.AppImage'))
    .sort(
      (left, right) =>
        statSync(join(release, right)).mtimeMs - statSync(join(release, left)).mtimeMs,
    )[0];
}

/**
 * Builds the Linux installer the way release.yml's Linux target does — `npm ci`, the renderer, the
 * main process, then `electron-builder --linux --x64 --publish never`, unsigned — in a Linux container.
 */
function buildInstaller() {
  rmSync(join(REPO, 'release'), { recursive: true, force: true });
  const steps = [
    'set -e',
    'stamp=node_modules/.e2e-install-lock',
    'if ! cmp -s package-lock.json "$stamp"; then npm ci && cp package-lock.json "$stamp"; fi',
    'npm run build',
    'npm run build:electron',
    'npx electron-builder --linux --x64 --publish never',
  ].join('\n');
  step('Build the Linux installer (in a container, as release.yml does)', 'docker', [
    'run',
    '--rm',
    '--init',
    '--platform',
    'linux/amd64',
    '--volume',
    `${REPO}:/work`,
    '--volume',
    `${MODULES}:/work/node_modules`,
    '--volume',
    `${CACHE}:/root/.cache`,
    '--workdir',
    '/work',
    // As release.yml: electron-builder downloads its own Electron for the target.
    '--env',
    'ELECTRON_SKIP_BINARY_DOWNLOAD=1',
    `node:${NODE_VERSION}-bookworm`,
    'bash',
    '-c',
    steps,
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
 * @param {string} installer The AppImage's file name in release/.
 * @param {readonly string[]} playwright Extra arguments for Playwright.
 * @returns {number} Returns Playwright's exit status.
 */
function runGate(distro, installer, playwright) {
  const output = join(REPO, 'e2e', 'install', 'output', distro);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  console.log(`\n▶ Install and set up Studio on ${distro}`);
  const container = `onixlabs-studio-install-${distro}-${Date.now()}`;
  return run('docker', [
    'run',
    '--rm',
    '--init',
    '--platform',
    'linux/amd64',
    '--name',
    container,
    // Chromium uses shared memory for its renderers; Docker's 64 MB default crashes them.
    '--shm-size=2g',
    // The harness — Playwright and the test — comes from the repository, read-only, with the
    // builder's Linux node_modules. Studio itself is only ever the installed copy.
    '--volume',
    `${REPO}:/work:ro`,
    '--volume',
    `${MODULES}:/work/node_modules:ro`,
    '--volume',
    `${join(REPO, 'release')}:/installers:ro`,
    '--volume',
    `${output}:/output`,
    '--env',
    `STUDIO_GATE_INSTALLER=/installers/${installer}`,
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

/**
 * Prints the per-plugin summary the test wrote.
 * @param {string} distro The distribution.
 * @param {number} status Playwright's exit status.
 */
function report(distro, status) {
  const file = join(REPO, 'e2e', 'install', 'output', distro, 'summary.json');
  console.log(`\n━━ ${distro}: ${status === 0 ? 'PASS' : 'FAIL'} ━━`);
  if (!existsSync(file)) {
    console.log(
      '  No summary was written: the run stopped before setup. See the Playwright output above.',
    );
    return;
  }
  const summary = JSON.parse(readFileSync(file, 'utf8'));
  const width = Math.max(...summary.plugins.map((plugin) => plugin.id.length), 10);
  for (const plugin of summary.plugins) {
    const mark = plugin.outcome === 'pass' ? '✔' : plugin.outcome === 'skipped' ? '–' : '✖';
    const why = plugin.reason ? `  ${plugin.reason}` : '';
    console.log(`  ${mark} ${plugin.id.padEnd(width)}  ${plugin.outcome.padEnd(7)}${why}`);
  }
  for (const finding of summary.findings ?? []) {
    console.log(`  ! ${finding}`);
  }
  const counts = summary.plugins.reduce((tally, plugin) => {
    tally[plugin.outcome] = (tally[plugin.outcome] ?? 0) + 1;
    return tally;
  }, {});
  console.log(
    `  ${Object.entries(counts)
      .map(([outcome, count]) => `${count} ${outcome}`)
      .join(
        ', ',
      )}; setup took ${Math.round((summary.setupSeconds ?? 0) / 60)} min, the run ${Math.round(
      (summary.totalSeconds ?? 0) / 60,
    )} min.`,
  );
  console.log(`  Evidence: e2e/install/output/${distro}/`);
}

try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
} catch {
  console.error(
    'Docker is not running. Start Docker Desktop (or the Docker engine) and try again.',
  );
  exit(1);
}

const { distros, reuseInstaller, playwright } = options();
const started = Date.now();
if (!reuseInstaller || builtInstaller() === undefined) {
  buildInstaller();
}
const installer = builtInstaller();
if (installer === undefined) {
  console.error('The build wrote no AppImage to release/.');
  exit(1);
}
console.log(`\nInstaller: release/${installer}`);

const results = [];
for (const distro of distros) {
  buildImage(distro);
  results.push([distro, runGate(distro, installer, playwright)]);
}
for (const [distro, status] of results) {
  report(distro, status);
}
console.log(`\nTotal ${Math.round((Date.now() - started) / 60000)} min.`);
exit(results.some(([, status]) => status !== 0) ? 1 : 0);
