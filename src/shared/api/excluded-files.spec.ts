import { describe, expect, it } from 'vitest';
import {
  excludedFileGlobs,
  isExcludedPath,
  isHiddenPath,
  normaliseExcludedFile,
  sanitizeExcludedFiles,
} from './excluded-files';

describe('excluded files (#1252)', () => {
  it('normalise_writesPosixSeparators_withoutDotSegmentsOrATrailingSlash', () => {
    expect(normaliseExcludedFile('src\\generated\\')).toBe('src/generated');
    expect(normaliseExcludedFile('./dist/')).toBe('dist');
    expect(normaliseExcludedFile('a//b/./c')).toBe('a/b/c');
  });

  it.each([
    ['/etc/passwd'],
    ['C:\\Windows'],
    ['../outside'],
    ['src/../../outside'],
    ['.'],
    [''],
    ['bad\nline'],
    ['a'.repeat(1025)],
  ])('normalise_refusesAPathThatIsAbsoluteEscapesOrNamesNothing %#', (path: string) => {
    expect(normaliseExcludedFile(path)).toBe('');
  });

  it('sanitize_keepsOnlyUsableCanonicalPaths_once_inTheirOrder', () => {
    expect(sanitizeExcludedFiles(['dist/', 'dist', 7, '../x', 'src\\gen', null, 'docs'])).toEqual([
      'dist',
      'src/gen',
      'docs',
    ]);
    expect(sanitizeExcludedFiles('dist')).toEqual([]);
    expect(sanitizeExcludedFiles(undefined)).toEqual([]);
  });

  it('sanitize_boundsTheList', () => {
    const many: string[] = Array.from({ length: 600 }, (_: unknown, index: number) => `f${index}`);

    expect(sanitizeExcludedFiles(many)).toHaveLength(500);
  });

  it('isExcluded_coversTheEntry_andEverythingInsideAnExcludedFolder_butNotANameSharingItsStart', () => {
    expect(isExcludedPath('dist', ['dist'])).toBe(true);
    expect(isExcludedPath('dist/app/main.js', ['dist'])).toBe(true);
    expect(isExcludedPath('distribution', ['dist'])).toBe(false);
    expect(isExcludedPath('src/dist', ['dist'])).toBe(false);
  });

  it('isHidden_whenAnySegmentStartsWithADot', () => {
    expect(isHiddenPath('.env')).toBe(true);
    expect(isHiddenPath('.github/workflows/ci.yml')).toBe(true);
    expect(isHiddenPath('src/main.ts')).toBe(false);
  });

  it('globs_anchorEachPathAtTheRoot_andCoverWhatIsInside', () => {
    expect(excludedFileGlobs(['dist', 'src/gen'])).toEqual([
      '/dist',
      '/dist/**',
      '/src/gen',
      '/src/gen/**',
    ]);
  });
});
