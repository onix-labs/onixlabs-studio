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

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

// Anchored to this file, so the output does not depend on where the script was run from.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const allowed = new Set(overrides.allowed);
const problems = [];
const warnings = [];

/**
 * Matches the files a package's notices are in: LICENSE, LICENCE, COPYING, NOTICE and
 * ThirdPartyNotices, in any case, plain or as text, Markdown or HTML. Source files that happen to
 * carry one of those words (license.js) are not notices.
 */
const NOTICE_FILE = /(licen[cs]e|copying|notice)/i;
const NOTICE_EXTENSIONS = new Set(['', '.txt', '.md', '.markdown', '.rst', '.html']);

/**
 * Reads a JSON file, or null when it is absent or unreadable.
 * @param {string} file The file.
 * @returns {any} The parsed value, or null.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Finds the package directory an esbuild input belongs to: the innermost `node_modules/<name>`.
 * @param {string} input The input's path, as the stats file records it.
 * @returns {string | null} The absolute directory, or null for an input from no package.
 */
function packageDirectoryOf(input) {
  // Stylesheet resources are recorded as `angular:css-resource:<path>`, with the platform's separators.
  const bare = input.replace(/^angular:[a-z-]+:/, '').replaceAll('\\', '/');
  const marker = 'node_modules/';
  const at = bare.lastIndexOf(marker);
  if (at === -1) {
    return null;
  }
  const rest = bare.slice(at + marker.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return resolve(REPO, bare.slice(0, at + marker.length) + name);
}

/**
 * Lists the package directories the renderer bundle took any bytes from.
 * @returns {Set<string>} The directories.
 */
function rendererPackages() {
  const stats = readJson(STATS);
  if (stats === null) {
    problems.push(`No bundle stats at ${STATS}: run \`ng build --stats-json\` first.`);
    return new Set();
  }
  const directories = new Set();
  for (const output of Object.values(stats.outputs ?? {})) {
    for (const [input, use] of Object.entries(output.inputs ?? {})) {
      const directory = use.bytesInOutput > 0 ? packageDirectoryOf(input) : null;
      if (directory !== null) {
        directories.add(directory);
      }
    }
  }
  return directories;
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

/**
 * Normalises a package's repository field to a URL a browser can open.
 * @param {unknown} repository The field.
 * @returns {string | null} The URL, or null.
 */
function repositoryUrl(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  const shorthand = raw.match(/^(github|gitlab|bitbucket):(.+)$/);
  if (shorthand !== null) {
    return `https://${shorthand[1]}.${shorthand[1] === 'bitbucket' ? 'org' : 'com'}/${shorthand[2]}`;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    return `https://github.com/${raw}`;
  }
  return raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '');
}

/**
 * Gets a package's declared licence, as an SPDX expression.
 * @param {any} manifest The package.json.
 * @returns {string | null} The expression, or null when it declares none.
 */
function declaredLicence(manifest) {
  if (typeof manifest.license === 'string') {
    return manifest.license;
  }
  if (typeof manifest.license?.type === 'string') {
    return manifest.license.type;
  }
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses.map((entry) => entry?.type).filter(Boolean);
    return types.length > 0 ? `(${types.join(' OR ')})` : null;
  }
  return null;
}

/**
 * Gets the author's name from a package.json, for a standard text's copyright line.
 * @param {any} manifest The package.json.
 * @returns {string | null} The name, or null.
 */
function authorName(manifest) {
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  return typeof author === 'string' ? author.replace(/\s*[<(].*$/, '').trim() || null : null;
}

/**
 * Reads the notice files in a directory.
 * @param {string} directory The directory.
 * @returns {string[]} Each file's text, headed by its name.
 */
function noticeTexts(directory) {
  let names;
  try {
    names = readdirSync(directory).sort();
  } catch {
    return [];
  }
  return names
    .filter((name) => NOTICE_FILE.test(name) && NOTICE_EXTENSIONS.has(extname(name).toLowerCase()))
    .map((name) => readFileSync(join(directory, name), 'utf8').trim());
}

/**
 * Gets a standard licence text, with its copyright line.
 * @param {string} licence The SPDX identifier.
 * @param {string | null} copyright The copyright line.
 * @param {string} who The package or component, for the error.
 * @returns {string | null} The text, or null when there is no standard text for the licence.
 */
function standardText(licence, copyright, who) {
  const template = join(REPO, 'licensing', 'texts', `${licence}.txt`);
  if (!existsSync(template)) {
    problems.push(`${who}: no standard text for ${licence} in licensing/texts.`);
    return null;
  }
  const text = readFileSync(template, 'utf8').trim();
  if (text.includes('{{copyright}}')) {
    if (copyright === null) {
      problems.push(`${who}: its standard ${licence} text needs a copyright line.`);
      return null;
    }
    return text.replace('{{copyright}}', copyright);
  }
  return copyright === null ? text : `${copyright}\n\n${text}`;
}

/**
 * Describes one package from its directory.
 * @param {string} directory The package's directory.
 * @returns {any} The entry, or null when it is not a package.
 */
function describePackage(directory) {
  const manifest = readJson(join(directory, 'package.json'));
  if (manifest === null || typeof manifest.name !== 'string') {
    problems.push(`${directory}: is shipped, but has no readable package.json to say what it is.`);
    return null;
  }
  const name = manifest.name;
  const election = overrides.elections[name];
  const fix = overrides.packages[name] ?? {};
  const declared = declaredLicence(manifest);
  const who = `${name}@${manifest.version}`;
  // An override answers for the package as it was when it was written: one whose licence has changed
  // since is looked at again, not carried on under the old answer.
  if (election !== undefined && declared !== election.offered) {
    problems.push(
      `${who}: now declares ${declared}, not the ${election.offered} its election in ` +
        'licensing/overrides.json was made for. Review the election.',
    );
  }
  if (fix.licence !== undefined && declared !== null) {
    problems.push(
      `${who}: now declares ${declared}; its licence fix in licensing/overrides.json is no longer ` +
        'needed, or is wrong. Review it.',
    );
  }
  const licence = election?.licence ?? fix.licence ?? declared;
  if (licence === null) {
    problems.push(`${who}: declares no licence; record one in licensing/overrides.json.`);
  } else if (!allowed.has(licence) && election === undefined) {
    problems.push(
      `${who}: ${licence} is not on the allowlist. Take it under an allowed licence (an election) ` +
        'or replace the package.',
    );
  }
  let texts = noticeTexts(directory);
  for (const extra of fix.extraTexts ?? []) {
    const file = join(directory, extra);
    if (existsSync(file)) {
      texts = [...texts, readFileSync(file, 'utf8').trim()];
    } else {
      problems.push(`${who}: has no ${extra}, which licensing/overrides.json lists for it.`);
    }
  }
  if (texts.length === 0 && fix.standardText === true && licence !== null) {
    const copyright =
      fix.copyright ??
      (authorName(manifest) === null ? null : `Copyright (c) ${authorName(manifest)}`);
    const text = standardText(licence, copyright, who);
    texts = text === null ? [] : [text];
  }
  if (texts.length === 0) {
    problems.push(
      `${who}: ships no licence text; add \`standardText\` for it in licensing/overrides.json.`,
    );
  }
  return {
    name,
    version: manifest.version,
    licence,
    ...(election === undefined ? {} : { offered: election.offered }),
    repository: repositoryUrl(manifest.repository),
    homepage: typeof manifest.homepage === 'string' ? manifest.homepage : null,
    texts,
  };
}

/**
 * Describes one component from licensing/overrides.json.
 * @param {any} component The override entry.
 * @returns {any} The entry.
 */
function describeComponent(component) {
  const version =
    component.versionFrom === undefined
      ? null
      : (readJson(join(REPO, 'node_modules', component.versionFrom, 'package.json'))?.version ??
        null);
  let texts = [];
  for (const file of component.texts ?? []) {
    if (existsSync(join(REPO, file))) {
      texts.push(readFileSync(join(REPO, file), 'utf8').trim());
    } else {
      problems.push(`${component.name}: its text ${file} is not there.`);
    }
  }
  if (component.notice !== undefined) {
    texts = [component.notice, ...texts];
  }
  if (component.standardText === true) {
    const text = standardText(component.licence, component.copyright ?? null, component.name);
    texts = text === null ? texts : [...texts, text];
  }
  // A component outside the allowlist needs a recorded reason, as an election does for a package.
  if (!allowed.has(component.licence) && component.accepted === undefined) {
    problems.push(
      `${component.name}: ${component.licence} is not on the allowlist, and nothing records why it ` +
        'is accepted.',
    );
  }
  if (texts.length === 0) {
    problems.push(`${component.name}: has no licence text or notice.`);
  }
  if (component.unverified !== undefined) {
    warnings.push(`${component.name}: ${component.unverified}`);
  }
  return {
    name: component.name,
    version,
    licence: component.licence,
    repository: component.repository ?? null,
    homepage: component.homepage ?? null,
    scopes: [component.scope],
    texts,
  };
}

// Gather every shipped package once, with every scope it ships in.
const scoped = new Map();
const add = (directory, scope) => {
  let real;
  try {
    real = realpathSync(directory);
  } catch {
    return;
  }
  const scopes = scoped.get(real) ?? new Set();
  scopes.add(scope);
  scoped.set(real, scopes);
};
for (const directory of rendererPackages()) {
  add(directory, 'renderer');
}
for (const directory of appPackages()) {
  add(directory, 'app');
}
for (const extra of overrides.include) {
  add(join(REPO, 'node_modules', extra.name), extra.scope);
}

const byKey = new Map();
for (const [directory, scopes] of scoped) {
  const entry = describePackage(directory);
  if (entry === null) {
    continue;
  }
  const key = `${entry.name}@${entry.version}`;
  const known = byKey.get(key);
  if (known === undefined) {
    byKey.set(key, { ...entry, scopes: [...scopes] });
  } else {
    known.scopes = [...new Set([...known.scopes, ...scopes])];
  }
}
const packages = [...byKey.values()].sort(
  (left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
);
const components = overrides.components.map(describeComponent);

const product = readJson(join(REPO, 'package.json'));
const studio = {
  name: 'ONIXLabs Studio',
  version: product.version,
  licence: product.license,
};

// licences.json: what the About dialog lists. The texts stay in the notices file.
const listed = [...components, ...packages].map(({ texts: _texts, ...entry }) => ({
  ...entry,
  scopes: [...entry.scopes].sort(),
}));
mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, `${JSON.stringify({ studio, entries: listed }, null, 2)}\n`);

// THIRD-PARTY-NOTICES.txt: every entry's full texts.
const rule = '-'.repeat(80);
const sections = [...components, ...packages].map((entry) =>
  [
    `${entry.name}${entry.version === null ? '' : ` ${entry.version}`}`,
    `Licence: ${entry.licence}${entry.offered === undefined ? '' : ` (offered as ${entry.offered})`}`,
    ...(entry.repository === null ? [] : [`Source: ${entry.repository}`]),
    '',
    ...entry.texts.flatMap((text) => [text, '']),
  ].join('\n'),
);
mkdirSync(dirname(NOTICES_OUT), { recursive: true });
writeFileSync(
  NOTICES_OUT,
  [
    `${studio.name} ${studio.version}: third-party notices`,
    '',
    `${studio.name} is licensed under ${studio.licence}; see LICENSE. It includes the software below,`,
    'each under its own licence, reproduced here as its authors require.',
    '',
    ...sections.flatMap((section) => [rule, section]),
  ].join('\n'),
);

for (const warning of warnings) {
  stderr.write(`warning: ${warning}\n`);
}
stdout.write(
  `Listed ${packages.length} packages and ${components.length} components ` +
    `(${packages.filter((entry) => entry.scopes.includes('renderer')).length} in the renderer, ` +
    `${packages.filter((entry) => entry.scopes.includes('app')).length} in the app).\n`,
);
if (problems.length > 0) {
  for (const problem of problems) {
    stderr.write(`error: ${problem}\n`);
  }
  exit(1);
}
