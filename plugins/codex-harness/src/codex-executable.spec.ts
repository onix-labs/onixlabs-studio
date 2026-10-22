import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCodexExecutable } from './codex-executable';

/**
 * The bundled copy, as the plugin's installation would provide it.
 * @returns Returns its path.
 */
function bundled(): { readonly path: string } {
  return { path: '/plugin/vendor/codex' };
}

describe('resolveCodexExecutable (#1079)', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'codex-exec-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('withNoChoiceOrBundled_runsTheBundledCopy', () => {
    for (const choice of [undefined, null, {}, { mode: 'bundled', path: '' }, { mode: 'odd' }]) {
      expect(resolveCodexExecutable(choice, {}, 'darwin', 'arm64', bundled)).toEqual({
        path: '/plugin/vendor/codex',
        own: false,
      });
    }
  });

  it('system_runsTheCodexOnThePath', () => {
    const codex: string = join(directory, 'codex');
    writeFileSync(codex, '');

    expect(
      resolveCodexExecutable(
        { mode: 'system' },
        { PATH: `/nowhere:${directory}` },
        'darwin',
        'arm64',
        bundled,
      ),
    ).toEqual({ path: codex, own: true });
  });

  it('system_onWindows_looksForCodexExe', () => {
    const codex: string = join(directory, 'codex.exe');
    writeFileSync(codex, '');

    expect(
      resolveCodexExecutable({ mode: 'system' }, { Path: directory }, 'win32', 'x64', bundled),
    ).toEqual({ path: codex, own: true });
  });

  it('system_withNoCodexOnThePath_fallsBackToBundled_sayingWhy', () => {
    const resolved: unknown = resolveCodexExecutable(
      { mode: 'system' },
      { PATH: directory },
      'darwin',
      'arm64',
      bundled,
    );

    expect(resolved).toMatchObject({ path: '/plugin/vendor/codex', own: false });
    expect((resolved as { fallback?: string }).fallback).toContain('PATH');
  });

  it('custom_runsThePathItNames', () => {
    const codex: string = join(directory, 'my-codex');
    writeFileSync(codex, '');

    expect(
      resolveCodexExecutable(
        { mode: 'custom', path: ` ${codex} ` },
        {},
        'darwin',
        'arm64',
        bundled,
      ),
    ).toEqual({ path: codex, own: true });
  });

  it('custom_whosePathIsMissing_fallsBackToBundled_sayingWhy', () => {
    const resolved: unknown = resolveCodexExecutable(
      { mode: 'custom', path: '/no/such/codex' },
      {},
      'darwin',
      'arm64',
      bundled,
    );

    expect(resolved).toMatchObject({ path: '/plugin/vendor/codex', own: false });
    expect((resolved as { fallback?: string }).fallback).toContain('/no/such/codex');
  });

  it('withNoBundledCopy_reportsWhy', () => {
    expect(
      resolveCodexExecutable(undefined, {}, 'darwin', 'arm64', () => ({ error: 'not installed' })),
    ).toEqual({ error: 'not installed' });
  });
});
