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
