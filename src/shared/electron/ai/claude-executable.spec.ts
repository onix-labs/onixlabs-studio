import { afterEach } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveClaudeExecutable, resolveExecutableOnPath } from './claude-executable';

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

  describe('resolveClaudeExecutable', () => {
    it('resolveClaudeExecutable_whenBundledOrUndefined_returnsUndefinedUnderTestRunner', () => {
      // Under the test runner Electron's `app` is unavailable, so the bundled resolution yields
      // undefined (letting the SDK resolve its own CLI).
      expect(resolveClaudeExecutable(undefined)).toBeUndefined();
      expect(resolveClaudeExecutable({ mode: 'bundled', path: '' })).toBeUndefined();
    });

    it('resolveClaudeExecutable_whenCustomPathExists_usesIt', () => {
      expect(resolveClaudeExecutable({ mode: 'custom', path: process.execPath })).toBe(
        process.execPath,
      );
    });

    it('resolveClaudeExecutable_whenCustomPathMissing_fallsBackToBundled', () => {
      expect(resolveClaudeExecutable({ mode: 'custom', path: '/no/such/claude' })).toBeUndefined();
    });

    it('resolveClaudeExecutable_whenSystem_findsClaudeOnThePath', () => {
      const { dir, bin } = makeClaudeDir();
      process.env['PATH'] = dir;
      try {
        expect(resolveClaudeExecutable({ mode: 'system', path: '' })).toBe(bin);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
