import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findEngineCli } from './engine-cli';

describe.skipIf(process.platform === 'win32')('findEngineCli', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'engine-cli-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('findsAnExecutableOnThePath', () => {
    const tool: string = join(directory, 'enginectl');
    writeFileSync(tool, '#!/bin/sh\n', 'utf8');
    chmodSync(tool, 0o755);

    expect(findEngineCli('enginectl', { PATH: directory }, 'linux')).toBe(tool);
  });

  it('ignoresAFileThatCannotBeRun_andAnswersNullWhenNothingIsFound', () => {
    writeFileSync(join(directory, 'enginectl'), 'not a program', 'utf8');
    chmodSync(join(directory, 'enginectl'), 0o644);

    expect(findEngineCli('enginectl', { PATH: directory }, 'linux')).toBeNull();
    expect(findEngineCli('enginectl', {}, 'linux')).toBeNull();
  });
});
