// Resolves the bundled Claude Code native CLI binary for the Agent SDK in a packaged build.
//
// The SDK ships the CLI as a per-platform native binary (@anthropic-ai/claude-agent-sdk-<plat>-<arch>)
// and, left to its own devices, resolves it relative to its own module location. In a packaged build
// that location is inside `app.asar`, and a native binary cannot be executed from inside the archive
// (the OS sees `app.asar` as a file, so spawning a path *through* it fails with ENOTDIR). The
// electron-builder config `asarUnpack`s the binary so a runnable copy lives under `app.asar.unpacked`;
// this resolver returns that path for the agent provider to pass as `pathToClaudeCodeExecutable`.
//
// In development (unpackaged) it returns undefined so the SDK uses its own resolution, which works
// because the binary is a real file in node_modules.
//
// Validated in issue #141 (packaged macOS x64); see docs/spikes/packaging-cli-spawn.md. The consuming
// agent provider lands with the AI agent epic (#106).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Resolves the absolute path to the unpacked Claude Code CLI binary in a packaged build.
 * @returns Returns the unpacked binary path when packaged and present, or undefined to let the Agent
 * SDK resolve the binary itself (the correct behaviour in development).
 */
export function resolveBundledClaudeExecutable(): string | undefined {
  if (!app.isPackaged) {
    return undefined;
  }
  const binaryPackage: string = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const unpacked: string = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    binaryPackage,
    'claude',
  );
  return existsSync(unpacked) ? unpacked : undefined;
}
