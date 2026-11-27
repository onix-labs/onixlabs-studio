#!/usr/bin/env node
// Lists everything Studio ships that someone else wrote, with its licence, and fails the build when one
// is not allowed or cannot be shown (#1612).
//
// MIT, BSD, ISC and Apache-2.0 all ask for their notices to travel with the program, so the notices
// are generated from what is actually shipped, not from what package.json declares:
//
// - the renderer: the packages esbuild put into the Angular bundle, read from the build's stats file
//   (`ng build --stats-json`). The lockfile's `dev` flag cannot say this: Angular bundles many
//   devDependencies;
// - the main process: the lockfile's production packages, which electron-builder copies into the app,
//   as installed on this machine (a platform's optional packages exist only on that platform);
// - what npm cannot say, from licensing/overrides.json: components such as Electron and Chromium,
//   assets copied whole (Monaco), the licence taken for a dual-licensed package, and packages whose
//   metadata or licence file is missing.
//
// Writes dist/onixlabs-studio/browser/licences.json (for the About dialog) and
// dist/licences/THIRD-PARTY-NOTICES.txt (the full texts, packaged beside the app). Exits 1 when a
// licence is outside the allowlist, or a package has no licence text, so a Dependabot batch cannot
// bring one in unnoticed.
//
//   node scripts/generate-licences.mjs
//   node scripts/generate-licences.mjs --stats <stats.json> --json <out.json> --notices <out.txt>

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import {
  createLicensing,
  packagesFromMetafile,
  readJson,
  REPO,
  report,
  writeOutputs,
} from './licences/core.mjs';

/**
 * Reads a `--name value` argument, or its default.
 * @param {string} name The argument's name, without the dashes.
 * @param {string} fallback The default, relative to the repository.
 * @returns {string} The absolute path.
 */
function option(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && (argv[index + 1] === undefined || argv[index + 1].startsWith('--'))) {
    stderr.write(`--${name} needs a path.\n`);
    exit(2);
  }
  return resolve(REPO, index === -1 ? fallback : argv[index + 1]);
}

const STATS = option('stats', 'dist/onixlabs-studio/browser-stats.json');
const JSON_OUT = option('json', 'dist/onixlabs-studio/browser/licences.json');
const NOTICES_OUT = option('notices', 'dist/licences/THIRD-PARTY-NOTICES.txt');
const OVERRIDES = option('overrides', 'licensing/overrides.json');

const licensing = createLicensing(OVERRIDES);

/**
 * Lists the package directories the renderer bundle took any bytes from.
 * @returns {Set<string>} The directories.
 */
function rendererPackages() {
  const stats = readJson(STATS);
  if (stats === null) {
    licensing.problems.push(`No bundle stats at ${STATS}: run \`ng build --stats-json\` first.`);
    return new Set();
  }
  return packagesFromMetafile(stats, REPO);
}

/**
 * Lists the production packages electron-builder copies into the app, as installed here.
 * @returns {Set<string>} The directories.
 */
function appPackages() {
  const lock = readJson(join(REPO, 'package-lock.json'));
  const directories = new Set();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === '' || entry.dev === true || entry.link === true) {
      continue;
    }
    const directory = join(REPO, key);
    // An optional package for another platform is in the lockfile but not installed, and not shipped.
    if (existsSync(join(directory, 'package.json'))) {
      directories.add(directory);
    }
  }
  return directories;
}

const scoped = new Map();
for (const directory of rendererPackages()) {
  scoped.set(directory, ['renderer']);
}
for (const directory of appPackages()) {
  scoped.set(directory, [...(scoped.get(directory) ?? []), 'app']);
}
for (const extra of licensing.overrides.include) {
  const directory = join(REPO, 'node_modules', extra.name);
  scoped.set(directory, [...(scoped.get(directory) ?? []), extra.scope]);
}
const packages = licensing.collect(scoped);
const components = licensing.overrides.components.map(licensing.describeComponent);

const product = readJson(join(REPO, 'package.json'));
writeOutputs({
  jsonFile: JSON_OUT,
  noticesFile: NOTICES_OUT,
  subject: { name: 'ONIXLabs Studio', version: product.version, licence: product.license },
  entries: [...components, ...packages],
});

stdout.write(
  `Listed ${packages.length} packages and ${components.length} components ` +
    `(${packages.filter((entry) => entry.scopes.includes('renderer')).length} in the renderer, ` +
    `${packages.filter((entry) => entry.scopes.includes('app')).length} in the app).\n`,
);
if (!report(licensing)) {
  exit(1);
}
