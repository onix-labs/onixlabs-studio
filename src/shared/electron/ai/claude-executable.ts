// Finds a `claude` CLI for Studio's own Claude sign-in (claude-login.ts).
//
// Studio ships no Claude CLI of its own: running Claude is the Claude plugin's job, and the plugin
// installs the Agent SDK — and with it the native `claude` binary — into its own directory. Sign-in
// uses the CLI on the PATH when there is one, and otherwise borrows the plugin's copy, so someone
// without Claude Code installed can still sign in once the plugin is installed. A Claude login only
// exists once the plugin is, so its copy is there whenever sign-in needs it.

import { accessSync, constants, existsSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { logger } from '../logger';

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
 * Finds the `claude` binary inside the Claude plugin's installation: the Agent SDK's per-platform
 * package (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`) beside the plugin's own package, in the
 * same `node_modules`.
 * @param installedPath The plugin's installed entry point, as its install record holds it, or null when
 * the plugin is not installed.
 * @param platform The platform to resolve for.
 * @param arch The architecture to resolve for.
 * @returns Returns the binary's path, or undefined when the plugin or its binary is not there.
 */
export function resolvePluginClaudeExecutable(
  installedPath: string | null,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  if (installedPath === null) {
    return undefined;
  }
  // The entry point sits at `<install>/node_modules/@onixlabs/claude-harness/main.js`; walk up to the
  // `node_modules` that holds it.
  let directory: string = dirname(installedPath);
  while (basename(directory) !== 'node_modules') {
    const parent: string = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
  const binary: string = join(
    directory,
    '@anthropic-ai',
    `claude-agent-sdk-${platform}-${arch}`,
    platform === 'win32' ? 'claude.exe' : 'claude',
  );
  if (!existsSync(binary)) {
    logger.warn('claude-executable', `Claude plugin's CLI not found at ${binary}`);
    return undefined;
  }
  return binary;
}
