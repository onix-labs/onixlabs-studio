#!/usr/bin/env node
// Builds a first-party plugin's npm package and checks the tarball against the integrity its lockfile
// already pins.
//
// A plugin provisioned by `kind: 'npm'` installs a dependency tree, and a tree may hold nothing but
// packages — so a plugin of this shape ships its own code as one of them. That makes the release asset
// an npm tarball rather than a zip, and it makes the pinned integrity a claim about bytes this script
// is the only thing that produces.
//
// The check is the point. `verify-plugin-index.mjs` proves the *lockfile* still hashes to what the
// index claims; nothing proves the *tarball* does, because until it is published there is nothing to
// fetch. A rebuild that produced different bytes — a bumped esbuild, an edited source file, a version
// nobody re-pinned — would publish an asset that every user's install rejects on integrity, long after
// the person who caused it stopped looking. Catching it here costs one comparison.
//
//   node scripts/pack-plugin-tarball.mjs plugins/claude-harness
//   node scripts/pack-plugin-tarball.mjs plugins/claude-harness --out dist-plugins

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

// Anchored to this file rather than to the working directory. A script whose output depends on where it
// was run from is the very defect it exists to catch.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCKFILES = join(REPO, 'src/shared/electron/contributions/plugins/lockfiles');

const given = argv[2];
if (given === undefined) {
  stdout.write('usage: node scripts/pack-plugin-tarball.mjs <plugin-directory> [--out <dir>]\n');
  exit(2);
}
// Absolute throughout: `npm pack` reads a bare relative path as a package specifier rather than a
// directory, so `dist/package` sends it to the registry looking for a package called `dist`.
const directory = resolve(given);
const out = resolve(
  argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(directory, 'dist'),
);

/**
 * Reads a JSON file.
 * @param {string} path The file to read.
 * @returns {object} Returns the parsed document.
 */
function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const pkg = read(join(directory, 'package.json'));
const manifest = read(join(directory, 'plugin.json'));

// The manifest names the lockfile by the URL it is published at; the copy in this repository is the
// same document, and is what the release is built against.
const lockfile = read(join(LOCKFILES, `${basename(manifest.provision.lockfileUrl)}`));
const key = `node_modules/${pkg.name}`;
const pinned = lockfile.packages[key]?.integrity;
if (pinned === undefined) {
  stdout.write(`The lockfile has no entry for ${key}, so there is nothing to check against.\n`);
  exit(1);
}

// 🔥 A harness that bundles its dependencies resolves them out of the *repository's* `node_modules`,
// because the plugin declares none of its own — so the bytes this script pins are decided by whatever
// happens to be installed. A tree that has drifted from `package-lock.json` therefore produces a
// perfectly valid tarball pinning versions no clean checkout will ever build, and the failure surfaces
// on the release runner, after the merge, when the tag has already been spent.
//
// Compared only where both documents describe the same package: npm omits optional dependencies that do
// not apply to this platform, and those absences are correct rather than drift.
const installedLock = join(REPO, 'node_modules/.package-lock.json');
if (existsSync(installedLock)) {
  const locked = read(join(REPO, 'package-lock.json')).packages ?? {};
  const installed = read(installedLock).packages ?? {};
  const drifted = Object.keys(installed)
    .filter((path) => locked[path] !== undefined)
    .filter((path) => locked[path].version !== installed[path].version)
    .map(
      (path) =>
        `  ${path}\n    locked ${locked[path].version}, installed ${installed[path].version}`,
    );

  if (drifted.length > 0) {
    stdout.write(
      `\nThe installed tree does not match package-lock.json, in ${drifted.length} package(s):\n` +
        `${drifted.slice(0, 10).join('\n')}\n` +
        (drifted.length > 10 ? `  …and ${drifted.length - 10} more\n` : '') +
        `\nA bundling plugin takes its dependencies from this tree, so a pin computed here would be a\n` +
        `pin no clean checkout reproduces. Run \`npm ci\` and build again.\n`,
    );
    exit(1);
  }
}

stdout.write(`Building ${pkg.name} ${pkg.version}\n`);
execFileSync('node', [join(directory, 'build.mjs')], { stdio: 'inherit' });

mkdirSync(out, { recursive: true });
execFileSync(
  'npm',
  ['pack', join(directory, 'dist', 'package'), '--pack-destination', out, '--silent'],
  { stdio: 'inherit' },
);

// `npm pack` names the file after the package, flattening the scope's slash to a dash.
const tarball = join(out, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
const digest = createHash('sha512').update(readFileSync(tarball)).digest('base64');
const actual = `sha512-${digest}`;

if (actual !== pinned) {
  stdout.write(
    `\nThe tarball does not match what the lockfile pins.\n` +
      `  pinned ${pinned}\n` +
      `  actual ${actual}\n\n` +
      `Either the plugin's sources changed without the lockfile being regenerated, or a build tool\n` +
      `produced different bytes. Regenerate the lockfile and repin the index before releasing.\n`,
  );
  exit(1);
}

stdout.write(`\n${tarball}\nmatches the pinned ${pinned}\n`);
