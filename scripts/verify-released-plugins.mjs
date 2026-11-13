#!/usr/bin/env node
// Verifies that the Studio builds already released can still install every plugin they ship with.
//
// `verify-plugin-index.mjs` checks the index on `main`, which is what every build fetches. This checks
// what each *released* build carries in its own seed index, which is a different claim and the one
// beta.10 broke: its seed pinned lockfiles by hash at a URL naming `main`, the plugins were bumped on
// `main`, and that build could no longer install any of them. Nothing on `main` was wrong, so nothing
// that only looked at `main` could have caught it.
//
// For each release it resolves every npm-provisioned entry's lockfile the way that build does: from
// the copy compiled into it when it bundles one, otherwise by fetching the pinned URL and checking the
// pinned hash. Then it checks that every package the lockfile names can still be downloaded.
//
//   node scripts/verify-released-plugins.mjs                       # the last 3 releases since beta.11
//   node scripts/verify-released-plugins.mjs --last 5
//   node scripts/verify-released-plugins.mjs --since v2026.1.0     # a different first release
//
// Releases before v2026.1.0-beta.11 are out of scope by default: they predate the fix (tag-pinned and
// bundled lockfiles), are known not to install the plugins bumped after them, and would keep this red
// for as long as they were in the window.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { argv, exit, stdout } from 'node:process';

const INDEX = 'src/shared/electron/contributions/plugins/curated-plugins.json';
const BUNDLED = 'src/shared/electron/contributions/plugins/bundled-lockfiles.ts';
const LOCKFILES = 'src/shared/electron/contributions/plugins/lockfiles';

/**
 * Reads an option's value from the command line.
 * @param {string} name The option.
 * @param {string} fallback The value when it is absent.
 * @returns {string} Returns the value.
 */
function option(name, fallback) {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
}

/**
 * Reads a file as it was at a tag.
 * @param {string} tag The tag.
 * @param {string} path The path.
 * @returns {string|null} Returns the text, or null when the file did not exist there.
 */
function showAt(tag, path) {
  try {
    return execFileSync('git', ['show', `${tag}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Gets the releases to check, newest first.
 * @returns {string[]} Returns the tags.
 */
function releases() {
  const since = option('--since', 'v2026.1.0-beta.11');
  const last = Number(option('--last', '3'));
  // `versionsort.suffix=-` sorts a prerelease before its release: beta.11 < 2026.1.0.
  const tags = execFileSync(
    'git',
    ['-c', 'versionsort.suffix=-', 'tag', '--list', 'v*', '--sort=-v:refname'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter((tag) => tag.length > 0);
  const end = tags.indexOf(since);
  return (end === -1 ? [] : tags.slice(0, end + 1)).slice(0, last);
}

/**
 * Hashes bytes the way the index pins them: SHA-256, as hex.
 * @param {string|Buffer} bytes The bytes.
 * @returns {string} Returns the digest.
 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Resolves the lockfile a release installs an entry from, the way that release does.
 * @param {string} tag The release.
 * @param {string|null} bundled The release's bundled-lockfiles module, or null when it has none.
 * @param {{ id: string, provision: { lockfileUrl: string, sha256: string } }} entry The index entry.
 * @returns {Promise<{ source: string, text: string }>} Returns where it came from and its text.
 */
async function lockfileFor(tag, bundled, entry) {
  const name = entry.provision.lockfileUrl.split('/').pop();
  if (bundled !== null && bundled.includes(`./lockfiles/${name}'`)) {
    const text = showAt(tag, `${LOCKFILES}/${name}`);
    if (text === null) {
      throw new Error(`bundles ${name}, which is not in the release`);
    }
    if (sha256(text) !== entry.provision.sha256) {
      throw new Error(`bundles a ${name} that does not match its own pin`);
    }
    return { source: 'bundled', text };
  }
  const response = await fetch(entry.provision.lockfileUrl, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`lockfile HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== entry.provision.sha256) {
    throw new Error(`lockfile hashes to ${digest}, pinned ${entry.provision.sha256}`);
  }
  return { source: 'fetched', text: bytes.toString('utf8') };
}

/**
 * The package URLs already asked about, so one shared by several releases is asked for once.
 * @type {Map<string, Promise<number>>}
 */
const statuses = new Map();

/**
 * Asks whether a package can still be downloaded, without downloading it.
 * @param {string} url The package URL.
 * @returns {Promise<number>} Returns the final status, or 0 when the host could not be reached.
 */
function statusOf(url) {
  if (!statuses.has(url)) {
    statuses.set(
      url,
      fetch(url, { method: 'HEAD', redirect: 'follow' }).then(
        (response) => response.status,
        () => 0,
      ),
    );
  }
  return statuses.get(url);
}

const tags = releases();
if (tags.length === 0) {
  stdout.write('No releases in the window yet; nothing to verify.\n');
  exit(0);
}

let failures = 0;
for (const tag of tags) {
  const indexText = showAt(tag, INDEX);
  if (indexText === null) {
    stdout.write(`${tag}: has no curated index; skipped\n`);
    continue;
  }
  const bundled = showAt(tag, BUNDLED);
  const entries = JSON.parse(indexText).plugins.filter((entry) => entry.provision?.kind === 'npm');
  stdout.write(`${tag}: ${entries.length} npm-provisioned plugin(s)\n`);
  for (const entry of entries) {
    try {
      const { source, text } = await lockfileFor(tag, bundled, entry);
      const packages = Object.entries(JSON.parse(text).packages ?? {}).filter(
        ([path, value]) => path.length > 0 && typeof value.resolved === 'string',
      );
      const results = await Promise.all(
        packages.map(async ([path, value]) => [path, await statusOf(value.resolved)]),
      );
      const missing = results
        .filter(([, status]) => status < 200 || status >= 300)
        .map(([path, status]) => `${path} (${status === 0 ? 'unreachable' : `HTTP ${status}`})`);
      if (missing.length > 0) {
        throw new Error(`cannot download ${missing.join(', ')}`);
      }
      stdout.write(
        `  ok       ${entry.id} ${entry.version} (${source}, ${packages.length} packages)\n`,
      );
    } catch (error) {
      failures++;
      stdout.write(`  FAILED   ${entry.id} ${entry.version}: ${error.message}\n`);
    }
  }
}

stdout.write(
  failures === 0
    ? '\nEvery plugin the checked releases ship with still installs.\n'
    : `\n${failures} plugin(s) in released builds can no longer be installed.\n`,
);
exit(failures === 0 ? 0 : 1);
