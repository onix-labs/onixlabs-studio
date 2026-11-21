#!/usr/bin/env node
// Verifies that every pinned download in the curated plugin index still exists and still hashes to
// what the index claims.
//
// This is the one thing no unit test or end-to-end test can cover. A manifest is entirely a set of
// claims about *external* artifacts — this URL exists, its bytes hash to this, the archive extracts to
// that entry point — and a test that stubs the artifact tests everything except the claims. The
// failure it catches is real and silent: an upstream project deletes a release, retags an asset, or
// rebuilds it non-reproducibly, and nobody finds out until a user clicks Install.
//
// Deliberately not part of the normal gate: it downloads hundreds of megabytes and depends on five
// third-party hosts being reachable, which is not a thing a pull request should fail on. Run it before
// a release, or on a schedule.
//
//   node scripts/verify-plugin-index.mjs                  # this platform's downloads
//   node scripts/verify-plugin-index.mjs --all            # every platform's
//   node scripts/verify-plugin-index.mjs --plugin clangd  # one plugin
//   node scripts/verify-plugin-index.mjs --index <path>   # another copy of the index
//
// Every release an entry offers is checked: the entry's own top-level release, and each older one it
// lists under `releases` (#1467). A build that cannot run the newest installs one of those instead, so
// a rotten pin there breaks that build just as surely.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

const INDEX = argv.includes('--index')
  ? argv[argv.indexOf('--index') + 1]
  : 'src/shared/electron/contributions/plugins/curated-plugins.json';

// A first-party lockfile is published straight out of this repository, so its pinned URL is this prefix,
// a ref (the plugin's release tag, or `main` for the third-party servers' version-named lockfiles), and
// a path in the working tree.
const OWN = /^https:\/\/raw\.githubusercontent\.com\/onix-labs\/onixlabs-studio\/([^/]+)\/(.+)$/;

/**
 * Gets the platform key for the machine running this, matching the main process's own.
 * @returns Returns the `<platform>-<arch>` key.
 */
function platformKey() {
  return `${process.platform}-${process.arch}`;
}

/**
 * Reads a file as it is at a ref, when that ref is known to this checkout.
 * @param {string} ref The tag or branch.
 * @param {string} path The path.
 * @returns {Buffer|null} Returns the bytes, or null when the ref or the file is not there.
 */
function showAt(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Resolves a pinned URL that this repository itself publishes to the bytes it serves, without fetching.
 *
 * A lockfile pinned at `raw.githubusercontent.com/…/<ref>/…` is not a third-party artifact — it is a
 * file in this repository, served verbatim. When the ref is a tag this checkout has, the file as it is
 * at that tag is exactly what is served, and that is what an older release listed under `releases`
 * pins. Otherwise — `main`, or the tag of a release this very change introduces, which cannot exist
 * until it merges — the working tree is the document being proposed, and hashing it is both more useful
 * and more correct on a branch than fetching, which would check the *previous* revision or 404.
 *
 * Nothing is lost by not fetching. That the URL still resolves to somewhere is asserted by the plugin's
 * own contract spec, which pins the exact string and reads the file it names, so a moved or renamed
 * lockfile fails the unit suite rather than silently passing here.
 *
 * A tag this checkout lacks (a shallow clone without tags) is read from the working tree too, but only
 * provisionally: if those bytes do not match, the tag is fetched, since an older release's tag is
 * already published and the working tree has moved on from it.
 * @param {string} url The pinned URL.
 * @returns {{ bytes: Buffer, provisional: boolean }|null} Returns the bytes and whether they merely
 * stand in for a tag this checkout lacks, or null when the URL is somebody else's or the file is
 * nowhere in this checkout.
 */
function localBytes(url) {
  const match = OWN.exec(url);
  if (match === null) {
    return null;
  }
  const [, ref, path] = match;
  if (ref !== 'main') {
    const tagged = showAt(ref, path);
    if (tagged !== null) {
      return { bytes: tagged, provisional: false };
    }
  }
  return existsSync(path) ? { bytes: readFileSync(path), provisional: ref !== 'main' } : null;
}

/**
 * Lists the releases an index entry offers: the entry itself, then each one listed under `releases`
 * laid over it, the same way Studio reads them (`pluginReleaseCandidates` in `plugin-index.ts`).
 * @param {object} plugin The index entry.
 * @returns {Array<object>} Returns the releases, each a whole manifest.
 */
function releasesOf(plugin) {
  const { releases, ...latest } = plugin;
  const listed = Array.isArray(releases) ? releases : [];
  return [
    latest,
    ...listed
      .filter((release) => typeof release === 'object' && release !== null)
      .map((release) => ({ ...latest, ...release, id: latest.id })),
  ];
}

/**
 * Downloads a URL and returns its SHA-256, without holding the whole body in memory.
 * @param {string} url The URL to fetch.
 * @param {string} pinned The hash the index pins for it.
 * @returns {Promise<{ sha256: string, bytes: number }>} Returns the digest and size.
 */
async function digestOf(url, pinned) {
  const local = localBytes(url);
  if (local !== null) {
    const sha256 = createHash('sha256').update(local.bytes).digest('hex');
    if (sha256 === pinned || !local.provisional) {
      return { sha256, bytes: local.bytes.length };
    }
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * Collects the downloads to check, honouring the command-line filters.
 * @param {{ plugins: Array<object> }} index The parsed index.
 * @returns {Array<{ plugin: string, platform: string, url: string, sha256: string }>} The downloads.
 */
function downloadsToCheck(index) {
  const all = argv.includes('--all');
  const only = argv.includes('--plugin') ? argv[argv.indexOf('--plugin') + 1] : null;
  const key = platformKey();
  const checks = [];
  for (const plugin of index.plugins.flatMap(releasesOf)) {
    if (only !== null && plugin.id !== only) {
      continue;
    }
    const label = `${plugin.id} ${plugin.version}`;
    // An npm provision pins a lockfile rather than a per-platform archive; the lockfile itself is the
    // artifact whose hash is claimed, so it is checked the same way.
    if (plugin.provision?.kind === 'npm') {
      checks.push({
        plugin: label,
        platform: 'lockfile',
        url: plugin.provision.lockfileUrl,
        sha256: plugin.provision.sha256,
      });
      continue;
    }
    for (const [platform, download] of Object.entries(plugin.provision?.downloads ?? {})) {
      if (all || platform === key) {
        checks.push({ plugin: label, platform, url: download.url, sha256: download.sha256 });
      }
    }
  }
  // The same archive is often pinned for every platform; fetching it once is enough to prove it.
  const seen = new Set();
  return checks.filter((check) => {
    const token = `${check.url} ${check.sha256}`;
    if (seen.has(token)) {
      return false;
    }
    seen.add(token);
    return true;
  });
}

const index = JSON.parse(readFileSync(INDEX, 'utf8'));
const checks = downloadsToCheck(index);
stdout.write(
  `Verifying ${checks.length} pinned download(s) from index revision ${index.revision}\n`,
);

let failures = 0;
for (const check of checks) {
  const label = `${check.plugin} (${check.platform})`;
  try {
    const { sha256, bytes } = await digestOf(check.url, check.sha256);
    if (sha256 === check.sha256) {
      stdout.write(`  ok       ${label} — ${(bytes / 1e6).toFixed(1)}MB\n`);
    } else {
      failures += 1;
      stdout.write(`  MISMATCH ${label}\n    pinned ${check.sha256}\n    actual ${sha256}\n`);
    }
  } catch (error) {
    failures += 1;
    stdout.write(`  FAILED   ${label} — ${error.message}\n    ${check.url}\n`);
  }
}

stdout.write(
  failures === 0
    ? `\nAll ${checks.length} download(s) match what the index pins.\n`
    : `\n${failures} of ${checks.length} download(s) did not match.\n`,
);
exit(failures === 0 ? 0 : 1);
