// Finds the Codex binary the `@openai/codex` package installed for this machine.
//
// The package ships one native binary per platform as an optional dependency, each under its own
// package's `vendor/<target>/bin`, and the CLI's own launcher (`bin/codex.js`) resolves it the same
// way. Resolved here rather than through that launcher because the launcher is one more Node process
// between this harness and the server, and because it is an ES module a CommonJS bundle cannot load.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * The Rust target triple and platform package for each platform and architecture the CLI ships for.
 */
const TARGETS: Readonly<Record<string, { readonly triple: string; readonly pkg: string }>> = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', pkg: '@openai/codex-darwin-arm64' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', pkg: '@openai/codex-darwin-x64' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-musl', pkg: '@openai/codex-linux-arm64' },
  'linux-x64': { triple: 'x86_64-unknown-linux-musl', pkg: '@openai/codex-linux-x64' },
  'win32-arm64': { triple: 'aarch64-pc-windows-msvc', pkg: '@openai/codex-win32-arm64' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', pkg: '@openai/codex-win32-x64' },
};

/**
 * Finds the Codex binary for this machine.
 * @param platform The platform; defaults to this process's.
 * @param arch The architecture; defaults to this process's.
 * @returns Returns the binary's path, or the reason none was found.
 */
export function findCodexExecutable(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { readonly path: string } | { readonly error: string } {
  const target: { readonly triple: string; readonly pkg: string } | undefined =
    TARGETS[`${platform}-${arch}`];
  if (target === undefined) {
    return { error: `Codex has no build for ${platform} (${arch}).` };
  }
  const require: NodeJS.Require = createRequire(__filename);
  const roots: string[] = [];
  for (const pkg of [target.pkg, '@openai/codex']) {
    try {
      roots.push(join(dirname(require.resolve(`${pkg}/package.json`)), 'vendor'));
    } catch {
      // Not installed under this name; the next root may hold it.
    }
  }
  const binary: string = platform === 'win32' ? 'codex.exe' : 'codex';
  for (const root of roots) {
    const candidate: string = join(root, target.triple, 'bin', binary);
    if (existsSync(candidate)) {
      return { path: candidate };
    }
  }
  return {
    error: `The Codex binary for ${platform} (${arch}) is not installed; reinstall the Codex plugin.`,
  };
}

/**
 * The binary a turn's choice resolved to: where it is, whether it is the user's own rather than the
 * bundled copy, and — when the choice could not be honoured — why the bundled copy stands in.
 */
export interface ResolvedCodexExecutable {
  /**
   * Gets the binary's path.
   */
  readonly path: string;

  /**
   * Gets whether the binary is the user's own (`system` or `custom`), so a failure to start can say
   * which Codex failed rather than blame the bundled one.
   */
  readonly own: boolean;

  /**
   * Gets why the user's choice fell back to the bundled copy, or undefined when it did not.
   */
  readonly fallback?: string;
}

/**
 * Finds an executable on a PATH, returning the first match that exists.
 * @param name The executable's file name.
 * @param path The PATH to search.
 * @param separator The PATH separator for the platform.
 * @returns Returns the absolute path, or undefined when none is found.
 */
function onPath(name: string, path: string | undefined, separator: string): string | undefined {
  for (const directory of (path ?? '').split(separator)) {
    if (directory.length > 0 && existsSync(join(directory, name))) {
      return join(directory, name);
    }
  }
  return undefined;
}

/**
 * Resolves the Codex binary a turn asked for, from the user's choice as Studio sent it in the turn's
 * `providerSettings.codexExecutable`: the bundled copy (the default, and anything unrecognised), the
 * `codex` on the PATH, or a custom path. A `system` or `custom` choice that names nothing falls back to
 * the bundled copy, saying why, so a misconfiguration degrades to a working run — as Claude's does.
 * @param choice The `codexExecutable` setting, as Studio sent it.
 * @param env The environment whose PATH a `system` choice searches.
 * @param platform The platform; defaults to this process's.
 * @param arch The architecture; defaults to this process's.
 * @param bundled Finds the bundled copy; {@link findCodexExecutable} outside tests.
 * @returns Returns the binary, or the reason none was found.
 */
export function resolveCodexExecutable(
  choice: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  bundled: () => { readonly path: string } | { readonly error: string } = () =>
    findCodexExecutable(platform, arch),
): ResolvedCodexExecutable | { readonly error: string } {
  const mode: unknown = (choice as { mode?: unknown } | null | undefined)?.mode;
  let fallback: string | undefined;
  if (mode === 'system') {
    const name: string = platform === 'win32' ? 'codex.exe' : 'codex';
    const found: string | undefined = onPath(
      name,
      env['PATH'] ?? env['Path'],
      platform === 'win32' ? ';' : ':',
    );
    if (found !== undefined) {
      return { path: found, own: true };
    }
    fallback = 'No codex was found on the PATH, so the bundled Codex is used.';
  } else if (mode === 'custom') {
    const custom: unknown = (choice as { path?: unknown }).path;
    const path: string = typeof custom === 'string' ? custom.trim() : '';
    if (path.length > 0 && existsSync(path)) {
      return { path, own: true };
    }
    fallback = `No codex was found at '${path}', so the bundled Codex is used.`;
  }
  const copy: { readonly path: string } | { readonly error: string } = bundled();
  if ('error' in copy) {
    return copy;
  }
  return fallback === undefined ? { ...copy, own: false } : { ...copy, own: false, fallback };
}
