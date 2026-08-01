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

import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { app } from 'electron';
import type { ClaudeExecutableChoice } from '@shared/api/ai-types';

/**
 * Resolves the absolute path to the unpacked Claude Code CLI binary in a packaged build.
 * @returns Returns the unpacked binary path when packaged and present, or undefined to let the Agent
 * SDK resolve the binary itself (the correct behaviour in development).
 */
export function resolveBundledClaudeExecutable(): string | undefined {
  if (app?.isPackaged !== true) {
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

/**
 * Finds an executable of the given name on the PATH, returning the first runnable match or undefined.
 * Reads the process PATH (hydrated from the user's login shell at startup, #317), so it sees the same
 * tools an interactive shell would.
 * @param name The executable name to find.
 * @returns Returns the absolute path, or undefined when not found.
 */
export function resolveExecutableOnPath(name: string): string | undefined {
  const path: string | undefined = process.env['PATH'];
  if (path === undefined || path.length === 0) {
    return undefined;
  }
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate: string = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not present or not executable in this directory; keep looking.
    }
  }
  return undefined;
}

/**
 * Resolves the Claude Code CLI the agent harness should spawn from the user's choice, for the SDK's
 * `pathToClaudeCodeExecutable` option. Falls back to the bundled resolution (undefined in development,
 * the unpacked path when packaged) when `system` finds nothing on the PATH or `custom` names a path
 * that does not exist — so a misconfiguration degrades gracefully rather than failing the run.
 * @param choice The user's CLI choice, or undefined for the bundled default.
 * @returns Returns the absolute executable path, or undefined to let the SDK use its bundled CLI.
 */
export function resolveClaudeExecutable(choice: ClaudeExecutableChoice | undefined): string | undefined {
  if (choice === undefined || choice.mode === 'bundled') {
    return resolveBundledClaudeExecutable();
  }
  if (choice.mode === 'system') {
    return resolveExecutableOnPath('claude') ?? resolveBundledClaudeExecutable();
  }
  const custom: string = choice.path.trim();
  return custom.length > 0 && existsSync(custom) ? custom : resolveBundledClaudeExecutable();
}
