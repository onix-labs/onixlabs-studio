import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { metadataAsSourcePath } from './metadata-as-source';

describe('metadataAsSourcePath (#1133)', () => {
  let temporaryRoot: string;
  let decompiled: string;
  let outside: string;

  beforeEach(() => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'studio-mas-'));
    const folder: string = path.join(
      temporaryRoot,
      'MetadataAsSource',
      'abc',
      'DecompilationMetadataAsSourceFileProvider',
      'def',
    );
    mkdirSync(folder, { recursive: true });
    decompiled = path.join(folder, 'IReadOnlyList.cs');
    writeFileSync(decompiled, 'public interface IReadOnlyList<out T> { }');
    outside = path.join(temporaryRoot, 'secret.txt');
    writeFileSync(outside, 'not decompiled');
  });

  afterEach(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('acceptsAFileInsideTheMetadataAsSourceFolder_answeringItsRealPath', async () => {
    expect(await metadataAsSourcePath(decompiled, temporaryRoot)).toBe(realpathSync(decompiled));
  });

  it('refusesAFileOutsideIt_andTheFolderItself', async () => {
    expect(await metadataAsSourcePath(outside, temporaryRoot)).toBeNull();
    expect(
      await metadataAsSourcePath(path.join(temporaryRoot, 'MetadataAsSource'), temporaryRoot),
    ).toBeNull();
  });

  it('refusesASymlinkInsideTheFolderThatPointsOutsideIt', async () => {
    // A link planted inside names the file it points at; reading through it would read that file.
    const link: string = path.join(temporaryRoot, 'MetadataAsSource', 'abc', 'Sneaky.cs');
    symlinkSync(outside, link);

    expect(await metadataAsSourcePath(link, temporaryRoot)).toBeNull();
  });

  it('refusesAParentEscape_aRelativePath_aMissingFile_andNonStrings', async () => {
    const escape: string = path.join(temporaryRoot, 'MetadataAsSource', '..', 'secret.txt');

    expect(await metadataAsSourcePath(escape, temporaryRoot)).toBeNull();
    expect(await metadataAsSourcePath('MetadataAsSource/abc/A.cs', temporaryRoot)).toBeNull();
    expect(
      await metadataAsSourcePath(path.join(path.dirname(decompiled), 'Gone.cs'), temporaryRoot),
    ).toBeNull();
    expect(await metadataAsSourcePath(42, temporaryRoot)).toBeNull();
    expect(await metadataAsSourcePath('', temporaryRoot)).toBeNull();
  });

  it('isNull_whenTheServerHasWrittenNoDecompiledSourceYet', async () => {
    const empty: string = mkdtempSync(path.join(tmpdir(), 'studio-mas-empty-'));
    try {
      expect(await metadataAsSourcePath(decompiled, empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
