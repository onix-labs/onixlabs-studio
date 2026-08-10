// Resolves the bundled Codex native CLI binary for the Codex SDK in a packaged build.
//
// The Codex SDK (`@openai/codex-sdk`) spawns the `codex` CLI, shipped as a per-platform native binary
// under `@openai/codex-<platform>-<arch>/vendor/<target-triple>/bin/codex` (dispatched by the
// `@openai/codex` package). Left to its own devices the SDK resolves that binary relative to its module
// location, which in a packaged build is inside `app.asar` — a native binary cannot be spawned from
// inside the archive. The electron-builder config `asarUnpack`s the codex packages so a runnable copy
// lives under `app.asar.unpacked`; this resolver returns that path for the provider to pass as the
// SDK's `codexPathOverride`.
//
// In development (unpackaged) it returns undefined so the SDK resolves the binary itself (a real file in
// node_modules). Mirrors {@link resolveBundledClaudeExecutable} (#141). Packaging is validated
// separately; per-platform paths cannot be exercised in a dev run.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { logger } from '../logger';

/**
 * Resolves the absolute path to the unpacked Codex CLI binary in a packaged build.
 * @returns Returns the unpacked binary path when packaged and present, or undefined to let the Codex
 * SDK resolve the binary itself (the correct behaviour in development).
 */
export function resolveBundledCodexExecutable(): string | undefined {
  if (!app.isPackaged) {
    return undefined;
  }
  const binaryPackage: string = `codex-${process.platform}-${process.arch}`;
  const vendorRoot: string = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@openai',
    binaryPackage,
    'vendor',
  );
  if (!existsSync(vendorRoot)) {
    logger.warn('codex-executable', `Unpacked Codex vendor root not found at ${vendorRoot}`);
    return undefined;
  }
  // The binary lives under a single target-triple directory (e.g. `x86_64-apple-darwin`); rather than
  // hard-code every triple, scan for the one that ships the executable.
  const executable: string = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const target of readdirSync(vendorRoot)) {
    const candidate: string = join(vendorRoot, target, 'bin', executable);
    if (existsSync(candidate)) {
      logger.debug('codex-executable', `Resolved unpacked Codex CLI: ${candidate}`);
      return candidate;
    }
  }
  logger.warn('codex-executable', `No Codex CLI binary found under ${vendorRoot}`);
  return undefined;
}
