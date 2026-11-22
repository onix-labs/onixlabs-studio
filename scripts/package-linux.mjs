#!/usr/bin/env node
// Builds the Linux installer (the x64 AppImage) inside Debian 12, so it runs on the Linux systems
// people actually have.
//
// The AppImage carries one native module, node-pty, compiled at `npm ci` against the glibc of the
// machine that builds it, and it then refuses to load on any system with an older one. Built on
// GitHub's `ubuntu-latest` it required glibc 2.42, so Studio could not start on Debian 13 (2.41), let
// alone Ubuntu 24.04 LTS or Debian 12: the main process threw "Failed to load native module: pty.node"
// before its first window, and a user saw nothing but an error box. The install gate (#1546) found it.
// Debian 12's glibc is 2.36, which every supported distribution has or exceeds.
//
//   node scripts/package-linux.mjs                         as release.yml and install-gate.yml run it
//   node scripts/package-linux.mjs --modules <volume> --cache <volume>
//                                                          keep the container's node_modules and
//                                                          caches in Docker volumes (a macOS host,
//                                                          whose own node_modules is not Linux's)
//
// Writes release/*.AppImage, unsigned, exactly as `electron-builder --linux --x64` does.
//
// The image is pinned by digest in .linux-builder-image, beside .nvmrc, because it builds what ships:
// a tag can be repointed under us. Bump the two together — when .nvmrc moves, put the new version's
// bookworm tag and its digest in .linux-builder-image:
//
//   docker buildx imagetools inspect node:<version>-bookworm --format '{{json .Manifest.Digest}}'
//
// This refuses to build when the two disagree.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit, getgid, getuid } from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_VERSION = readFileSync(join(REPO, '.nvmrc'), 'utf8').trim();
const IMAGE = readFileSync(join(REPO, '.linux-builder-image'), 'utf8').trim();

if (
  !new RegExp(`^node:${NODE_VERSION.replaceAll('.', '\\.')}-bookworm@sha256:[0-9a-f]{64}$`).test(
    IMAGE,
  )
) {
  console.error(
    `.linux-builder-image (${IMAGE}) must be node:${NODE_VERSION}-bookworm@sha256:<digest>, the ` +
      'version .nvmrc names, pinned by digest. Bump the two together.',
  );
  exit(1);
}

/**
 * Reads an option's value.
 * @param {string} name The option.
 * @returns {string | undefined} Returns its value, or undefined when it was not given.
 */
function option(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

const modules = option('--modules');
const cache = option('--cache');

// `npm ci` is skipped while the lockfile it was made from is unchanged, which only matters when the
// node_modules lives on in a volume between runs.
const steps = [
  'set -e',
  'stamp=node_modules/.package-linux-lock',
  'if ! cmp -s package-lock.json "$stamp"; then npm ci && cp package-lock.json "$stamp"; fi',
  'npm run build',
  'npm run build:electron',
  'npx electron-builder --linux --x64 --publish never',
].join('\n');

const volumes = [
  '--volume',
  `${REPO}:/work`,
  ...(modules === undefined ? [] : ['--volume', `${modules}:/work/node_modules`]),
  ...(cache === undefined ? [] : ['--volume', `${cache}:/tmp/builder/.cache`]),
];

// On a Linux host, as the invoking user, so what it writes into the checkout stays theirs. Docker
// Desktop maps ownership itself, and its named volumes are root's, so elsewhere it runs as root.
const user =
  process.platform === 'linux' && getuid !== undefined && getgid !== undefined
    ? ['--user', `${getuid()}:${getgid()}`]
    : [];

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--init',
    '--platform',
    'linux/amd64',
    ...user,
    ...volumes,
    '--workdir',
    '/work',
    '--env',
    'HOME=/tmp/builder',
    // As release.yml: electron-builder downloads its own Electron for the target.
    '--env',
    'ELECTRON_SKIP_BINARY_DOWNLOAD=1',
    IMAGE,
    'bash',
    '-c',
    steps,
  ],
  { cwd: REPO, stdio: 'inherit' },
);
exit(result.status ?? 1);
