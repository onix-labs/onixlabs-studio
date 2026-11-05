import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugAdapterLocator, debugAdapterCandidates } from './debug-adapter-locator';

describe('debugAdapterCandidates', () => {
  const pathValue: string = ['/one', '', '/two'].join(path.delimiter);

  it('triesTheOverride_thenTheProject_thenThePath', () => {
    expect(debugAdapterCandidates('dbg', '/root', pathValue, 'darwin', '/custom/dbg')).toEqual([
      '/custom/dbg',
      path.join('/root', 'node_modules', '.bin', 'dbg'),
      path.join('/one', 'dbg'),
      path.join('/two', 'dbg'),
    ]);
  });

  it('expandsExecutableExtensions_onWindowsOnly', () => {
    expect(debugAdapterCandidates('dbg', '/root', undefined, 'win32')).toEqual(
      ['.exe', '.cmd', '.bat', ''].map((extension: string): string =>
        path.join('/root', 'node_modules', '.bin', `dbg${extension}`),
      ),
    );
  });

  it('copesWithNoPath_andAnEmptyOverride', () => {
    expect(debugAdapterCandidates('dbg', '/root', '', 'linux', '')).toEqual([
      path.join('/root', 'node_modules', '.bin', 'dbg'),
    ]);
  });
});

describe('DebugAdapterLocator', () => {
  let scratch: string = '';
  let bin: string = '';

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-debug-locator-'));
    bin = path.join(scratch, 'bin');
    mkdirSync(bin);
    vi.stubEnv('PATH', bin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('findsTheProjectsCopy_beforeThePaths', async () => {
    const local: string = path.join(scratch, 'node_modules', '.bin');
    mkdirSync(local, { recursive: true });
    writeFileSync(path.join(local, 'dbg'), '');
    writeFileSync(path.join(bin, 'dbg'), '');

    expect(await new DebugAdapterLocator().locate('dbg', scratch)).toBe(path.join(local, 'dbg'));
  });

  it('prefersAnOverride', async () => {
    const override: string = path.join(scratch, 'mine');
    writeFileSync(override, '');
    writeFileSync(path.join(bin, 'dbg'), '');

    expect(
      await new DebugAdapterLocator(new Map<string, string>([['dbg', override]])).locate(
        'dbg',
        scratch,
      ),
    ).toBe(override);
  });

  it('skipsADirectoryWithTheAdaptersName', async () => {
    mkdirSync(path.join(bin, 'dbg'));

    expect(await new DebugAdapterLocator().locate('dbg', scratch)).toBeNull();
  });

  it('remembersAnAdapterItFound', async () => {
    const found: string = path.join(bin, 'dbg');
    writeFileSync(found, '');
    const locator: DebugAdapterLocator = new DebugAdapterLocator();
    await locator.locate('dbg', scratch);
    rmSync(found);

    expect(await locator.locate('dbg', scratch)).toBe(found);
  });

  it('findsAnAdapterInstalledAfterAMiss_withoutARestart', async () => {
    const locator: DebugAdapterLocator = new DebugAdapterLocator();
    expect(await locator.locate('dbg', scratch)).toBeNull();

    writeFileSync(path.join(bin, 'dbg'), '');

    expect(await locator.locate('dbg', scratch)).toBe(path.join(bin, 'dbg'));
  });

  it('keepsWorkspacesApart', async () => {
    const other: string = path.join(scratch, 'other');
    const local: string = path.join(other, 'node_modules', '.bin');
    mkdirSync(local, { recursive: true });
    writeFileSync(path.join(local, 'dbg'), '');
    const locator: DebugAdapterLocator = new DebugAdapterLocator();

    expect(await locator.locate('dbg', scratch)).toBeNull();
    expect(await locator.locate('dbg', other)).toBe(path.join(local, 'dbg'));
  });
});
