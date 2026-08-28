import BASH_LANGUAGE_SERVER from './lockfiles/bash-language-server.lock.json';
import DOCKERFILE_LANGUAGE_SERVER from './lockfiles/dockerfile-language-server.lock.json';
import SVELTE_LANGUAGE_SERVER from './lockfiles/svelte-language-server.lock.json';
import VSCODE_LANGSERVERS_EXTRACTED from './lockfiles/vscode-langservers-extracted.lock.json';
import YAML_LANGUAGE_SERVER from './lockfiles/yaml-language-server.lock.json';

// The lockfiles for the npm-provisioned plugins the curated index offers, compiled into the
// application — the same two-copies arrangement `plugin-index.ts` uses for the index itself, and for
// the same reason: a machine that cannot reach the published copy still has to be able to install.
//
// It is not merely an offline convenience. `raw.githubusercontent.com` does not serve a **private**
// repository at all, to anyone, authenticated or not — so while this repository stays private the
// published copy of every one of these documents 404s, and the compiled-in copy is the only one there
// is. The index has quietly relied on its own seed for exactly this reason.
//
// A bundled document is **not** hash-checked, and does not need to be: the pinned SHA-256 exists to
// verify a download, and this shipped inside the same bundle as the code that reads it. The pin still
// governs the fetched copy, and a test keeps the two from drifting apart.

/**
 * The lockfiles shipped with the application, keyed by the file name their published URL ends with.
 *
 * Keyed by file name rather than by whole URL so the branch or host in a published URL can change
 * without silently orphaning the bundled copy and falling back to a fetch that cannot succeed.
 */
const BUNDLED_LOCKFILES: Readonly<Record<string, unknown>> = {
  'bash-language-server.lock.json': BASH_LANGUAGE_SERVER,
  'dockerfile-language-server.lock.json': DOCKERFILE_LANGUAGE_SERVER,
  'svelte-language-server.lock.json': SVELTE_LANGUAGE_SERVER,
  'vscode-langservers-extracted.lock.json': VSCODE_LANGSERVERS_EXTRACTED,
  'yaml-language-server.lock.json': YAML_LANGUAGE_SERVER,
};

/**
 * Gets the lockfile compiled in for a published URL, if there is one.
 * @param url The lockfile URL a manifest pins.
 * @returns Returns the bundled document, or null when none ships for that URL.
 */
export function bundledLockfile(url: string): unknown {
  const name: string = url.split('/').pop() ?? '';
  return BUNDLED_LOCKFILES[name] ?? null;
}
