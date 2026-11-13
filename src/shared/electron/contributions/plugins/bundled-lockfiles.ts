import BASH_LANGUAGE_SERVER from './lockfiles/bash-language-server.lock.json';
import DOCKER_ENGINE from './lockfiles/docker-engine.lock.json';
import DOCKERFILE_LANGUAGE_SERVER from './lockfiles/dockerfile-language-server.lock.json';
import NEO4J_ENGINE from './lockfiles/neo4j-engine.lock.json';
import AI_SDK_HARNESS from './lockfiles/onixlabs.ai-sdk-harness.lock.json';
import CARGO from './lockfiles/onixlabs.cargo.lock.json';
import CLAUDE_HARNESS from './lockfiles/onixlabs.claude-harness.lock.json';
import CODEX_HARNESS from './lockfiles/onixlabs.codex-harness.lock.json';
import CONAN from './lockfiles/onixlabs.conan.lock.json';
import CTEST from './lockfiles/onixlabs.ctest.lock.json';
import DOTNET_TESTS from './lockfiles/onixlabs.dotnet-tests.lock.json';
import GIT from './lockfiles/onixlabs.git.lock.json';
import GITHUB from './lockfiles/onixlabs.github.lock.json';
import GO_MODULES from './lockfiles/onixlabs.go-modules.lock.json';
import GO_TESTS from './lockfiles/onixlabs.go-tests.lock.json';
import JS_TESTS from './lockfiles/onixlabs.js-tests.lock.json';
import JVM_TESTS from './lockfiles/onixlabs.jvm-tests.lock.json';
import MAVEN from './lockfiles/onixlabs.maven.lock.json';
import NPM from './lockfiles/onixlabs.npm.lock.json';
import NUGET from './lockfiles/onixlabs.nuget.lock.json';
import PYPI from './lockfiles/onixlabs.pypi.lock.json';
import PYTHON_TESTS from './lockfiles/onixlabs.python-tests.lock.json';
import RUST_TESTS from './lockfiles/onixlabs.rust-tests.lock.json';
import VCPKG from './lockfiles/onixlabs.vcpkg.lock.json';
import PODMAN_ENGINE from './lockfiles/podman-engine.lock.json';
import POSTGRES_ENGINE from './lockfiles/postgres-engine.lock.json';
import SQLITE_ENGINE from './lockfiles/sqlite-engine.lock.json';
import SQLSERVER_ENGINE from './lockfiles/sqlserver-engine.lock.json';
import SVELTE_LANGUAGE_SERVER from './lockfiles/svelte-language-server.lock.json';
import VSCODE_LANGSERVERS_EXTRACTED from './lockfiles/vscode-langservers-extracted.lock.json';
import YAML_LANGUAGE_SERVER from './lockfiles/yaml-language-server.lock.json';
import SEED_INDEX from './curated-plugins.json';

// The lockfiles for the npm-provisioned plugins the curated index offers, compiled into the
// application — the same two-copies arrangement `plugin-index.ts` uses for the index itself, and for
// the same reason: a machine that cannot reach the published copy still has to be able to install.
//
// Every lockfile the seed index pins is here, first-party plugins included. Before they were, a
// first-party install always fetched its lockfile from a URL naming `main`: the moment a plugin was
// bumped there, every build already shipped pinned a hash the file no longer had, and could not install
// that plugin at all (beta.10 could install none of the eight bumped after it).
//
// A bundled document is served only for the exact pin it shipped against. The pin is a hash of the
// published bytes, and a bundled copy is parsed JSON with no bytes to hash, so it is matched through the
// seed instead: the seed index is compiled in beside it, a test holds every bundled file to the hash the
// seed pins for it, and so a request carrying that hash is a request for this very document. A fetched
// index pinning anything newer gets nothing here, and downloads and checks its lockfile as before.

/**
 * The lockfiles shipped with the application, keyed by the file name their published URL ends with.
 *
 * Keyed by file name rather than by whole URL so the ref or host in a published URL can change without
 * silently orphaning the bundled copy and falling back to a fetch that cannot succeed.
 */
const BUNDLED_LOCKFILES: Readonly<Record<string, unknown>> = {
  'bash-language-server.lock.json': BASH_LANGUAGE_SERVER,
  'docker-engine.lock.json': DOCKER_ENGINE,
  'dockerfile-language-server.lock.json': DOCKERFILE_LANGUAGE_SERVER,
  'neo4j-engine.lock.json': NEO4J_ENGINE,
  'onixlabs.ai-sdk-harness.lock.json': AI_SDK_HARNESS,
  'onixlabs.cargo.lock.json': CARGO,
  'onixlabs.claude-harness.lock.json': CLAUDE_HARNESS,
  'onixlabs.codex-harness.lock.json': CODEX_HARNESS,
  'onixlabs.conan.lock.json': CONAN,
  'onixlabs.ctest.lock.json': CTEST,
  'onixlabs.dotnet-tests.lock.json': DOTNET_TESTS,
  'onixlabs.git.lock.json': GIT,
  'onixlabs.github.lock.json': GITHUB,
  'onixlabs.go-modules.lock.json': GO_MODULES,
  'onixlabs.go-tests.lock.json': GO_TESTS,
  'onixlabs.js-tests.lock.json': JS_TESTS,
  'onixlabs.jvm-tests.lock.json': JVM_TESTS,
  'onixlabs.maven.lock.json': MAVEN,
  'onixlabs.npm.lock.json': NPM,
  'onixlabs.nuget.lock.json': NUGET,
  'onixlabs.pypi.lock.json': PYPI,
  'onixlabs.python-tests.lock.json': PYTHON_TESTS,
  'onixlabs.rust-tests.lock.json': RUST_TESTS,
  'onixlabs.vcpkg.lock.json': VCPKG,
  'podman-engine.lock.json': PODMAN_ENGINE,
  'postgres-engine.lock.json': POSTGRES_ENGINE,
  'sqlite-engine.lock.json': SQLITE_ENGINE,
  'sqlserver-engine.lock.json': SQLSERVER_ENGINE,
  'svelte-language-server.lock.json': SVELTE_LANGUAGE_SERVER,
  'vscode-langservers-extracted.lock.json': VSCODE_LANGSERVERS_EXTRACTED,
  'yaml-language-server.lock.json': YAML_LANGUAGE_SERVER,
};

/**
 * Describes the part of a seed entry the pins are read from.
 */
interface SeedEntry {
  /**
   * Gets how the plugin is provisioned, when it says.
   */
  readonly provision?: { readonly lockfileUrl?: string; readonly sha256?: string };
}

/**
 * Gets the name a lockfile URL ends with.
 * @param url The lockfile URL.
 * @returns Returns the file name.
 */
function fileNameOf(url: string): string {
  return url.split('/').pop() ?? '';
}

/**
 * The hash the seed index pins for each lockfile, keyed by file name.
 */
const SEED_PINS: ReadonlyMap<string, string> = new Map<string, string>(
  (SEED_INDEX.plugins as readonly SeedEntry[]).flatMap((entry: SeedEntry): [string, string][] =>
    typeof entry.provision?.lockfileUrl === 'string' && typeof entry.provision.sha256 === 'string'
      ? [[fileNameOf(entry.provision.lockfileUrl), entry.provision.sha256]]
      : [],
  ),
);

/**
 * Gets the lockfile compiled in for a pinned URL and hash, if there is one.
 * @param url The lockfile URL a manifest pins.
 * @param sha256 The hash the manifest pins for it.
 * @returns Returns the bundled document, or null when none ships for exactly that pin.
 */
export function bundledLockfile(url: string, sha256: string): unknown {
  const name: string = fileNameOf(url);
  if (SEED_PINS.get(name) !== sha256) {
    return null;
  }
  return BUNDLED_LOCKFILES[name] ?? null;
}
