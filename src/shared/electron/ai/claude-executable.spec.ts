import { afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExecutableOnPath, resolvePluginClaudeExecutable } from './claude-executable';

/**
 * Creates a temporary directory holding an executable `claude` stub, returning both paths.
 * @returns Returns the directory and the executable path.
 */
function makeClaudeDir(): { dir: string; bin: string } {
  const dir: string = mkdtempSync(join(tmpdir(), 'claude-exec-'));
  const bin: string = join(dir, 'claude');
  writeFileSync(bin, '#!/bin/sh\n');
  chmodSync(bin, 0o755);
  return { dir, bin };
}

describe('claude-executable', () => {
  const savedPath: string | undefined = process.env['PATH'];

  afterEach(() => {
    if (savedPath === undefined) {
      delete process.env['PATH'];
    } else {
      process.env['PATH'] = savedPath;
    }
  });

  describe('resolveExecutableOnPath', () => {
    it('resolveExecutableOnPath_whenPresentAndExecutable_returnsThePath', () => {
      const { dir, bin } = makeClaudeDir();
      process.env['PATH'] = dir;
      try {
        expect(resolveExecutableOnPath('claude')).toBe(bin);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('resolveExecutableOnPath_whenAbsent_returnsUndefined', () => {
      const dir: string = mkdtempSync(join(tmpdir(), 'empty-'));
      process.env['PATH'] = dir;
      try {
        expect(resolveExecutableOnPath('claude')).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('resolvePluginClaudeExecutable', () => {
    /**
     * Lays out a Claude plugin install the way the Plugin Manager provisions one: the harness's entry
     * point and the Agent SDK's per-platform package side by side in one `node_modules`.
     * @param platformPackage The SDK platform package to create, or null for none.
     * @param binary The binary's file name.
     * @returns Returns the install root, the entry point, and the binary's expected path.
     */
    function makeInstall(
      platformPackage: string | null,
      binary: string = 'claude',
    ): { root: string; entry: string; bin: string } {
      const root: string = mkdtempSync(join(tmpdir(), 'claude-plugin-'));
      const modules: string = join(root, '0.15.0', 'darwin-arm64', 'node_modules');
      const entry: string = join(modules, '@onixlabs', 'claude-harness', 'main.js');
      mkdirSync(join(modules, '@onixlabs', 'claude-harness'), { recursive: true });
      writeFileSync(entry, '');
      const bin: string = join(modules, '@anthropic-ai', platformPackage ?? 'none', binary);
      if (platformPackage !== null) {
        mkdirSync(join(modules, '@anthropic-ai', platformPackage), { recursive: true });
        writeFileSync(bin, '');
      }
      return { root, entry, bin };
    }

    it('resolvePluginClaudeExecutable_findsThePluginsOwnCopyBesideItsEntryPoint', () => {
      const { root, entry, bin } = makeInstall('claude-agent-sdk-darwin-arm64');
      try {
        expect(resolvePluginClaudeExecutable(entry, 'darwin', 'arm64')).toBe(bin);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('resolvePluginClaudeExecutable_onWindows_findsClaudeExe', () => {
      const { root, entry, bin } = makeInstall('claude-agent-sdk-win32-x64', 'claude.exe');
      try {
        expect(resolvePluginClaudeExecutable(entry, 'win32', 'x64')).toBe(bin);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('resolvePluginClaudeExecutable_withoutThePluginOrItsBinary_findsNothing', () => {
      const { root, entry } = makeInstall(null);
      try {
        expect(resolvePluginClaudeExecutable(null)).toBeUndefined();
        expect(resolvePluginClaudeExecutable(entry, 'darwin', 'arm64')).toBeUndefined();
        expect(resolvePluginClaudeExecutable('/not/in/a/node_modules/main.js')).toBeUndefined();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
