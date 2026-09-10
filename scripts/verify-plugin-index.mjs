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

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

const INDEX = 'src/shared/electron/contributions/plugins/curated-plugins.json';

// A first-party lockfile is published straight out of this repository, so its pinned URL is this prefix
// plus a path in the working tree.
const OWN = 'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/';

/**
 * Gets the platform key for the machine running this, matching the main process's own.
 * @returns Returns the `<platform>-<arch>` key.
 */
function platformKey() {
  return `${process.platform}-${process.arch}`;
}

/**
 * Resolves a pinned URL that this repository itself publishes to the file in the working tree.
 *
 * A lockfile pinned at `raw.githubusercontent.com/…/main/…` is not a third-party artifact — it is a
 * file in this checkout, served verbatim once merged. Hashing the checkout rather than fetching `main`
 * is both more useful and more correct on a branch: it proves the pin matches the document being
 * proposed, where fetching would either check the *previous* revision or, for a lockfile added by the
 * same change, 404 until after the merge that the check is supposed to gate.
 *
 * Nothing is lost by not fetching. That the URL still resolves to somewhere is asserted by the plugin's
 * own contract spec, which pins the exact string and reads the file it names, so a moved or renamed
 * lockfile fails the unit suite rather than silently passing here.
 * @param {string} url The pinned URL.
 * @returns {string|null} Returns the local path, or null when the URL is somebody else's.
 */
function localPath(url) {
  if (!url.startsWith(OWN)) {
    return null;
  }
  const path = url.slice(OWN.length);
  return existsSync(path) ? path : null;
}

/**
 * Downloads a URL and returns its SHA-256, without holding the whole body in memory.
 * @param {string} url The URL to fetch.
 * @returns {Promise<{ sha256: string, bytes: number }>} Returns the digest and size.
 */
async function digestOf(url) {
  const path = localPath(url);
  if (path !== null) {
    const bytes = readFileSync(path);
    return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
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
  for (const plugin of index.plugins) {
    if (only !== null && plugin.id !== only) {
      continue;
    }
    // An npm provision pins a lockfile rather than a per-platform archive; the lockfile itself is the
    // artifact whose hash is claimed, so it is checked the same way.
    if (plugin.provision.kind === 'npm') {
      checks.push({
        plugin: plugin.id,
        platform: 'lockfile',
        url: plugin.provision.lockfileUrl,
        sha256: plugin.provision.sha256,
      });
      continue;
    }
    for (const [platform, download] of Object.entries(plugin.provision.downloads)) {
      if (all || platform === key) {
        checks.push({ plugin: plugin.id, platform, url: download.url, sha256: download.sha256 });
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
    const { sha256, bytes } = await digestOf(check.url);
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
