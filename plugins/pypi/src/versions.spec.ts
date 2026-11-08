import { describe, expect, it } from 'vitest';
import { compareVersions, deriveStatus, isPrerelease, newestRelease } from './versions';

describe('compareVersions', () => {
  it.each<[string, string]>([
    ['1.0.dev1', '1.0a1'],
    ['1.0a1', '1.0a2'],
    ['1.0a2', '1.0b1'],
    ['1.0b1', '1.0rc1'],
    ['1.0rc1', '1.0'],
    ['1.0', '1.0.post1'],
    ['1.0.post1', '1.1'],
    ['1.9', '1.10'],
    ['1.0', '1.0+local'],
    ['2024.1', '1!0.1'],
    ['not-a-version', '0.0.1'],
  ])('compareVersions_%s_isOlderThan_%s', (older: string, newer: string) => {
    // Act
    const forward: number = compareVersions(older, newer);
    const backward: number = compareVersions(newer, older);

    // Assert
    expect(forward).toBeLessThan(0);
    expect(backward).toBeGreaterThan(0);
  });

  it.each<[string, string]>([
    ['1.0', '1.0.0'],
    ['1.0RC1', '1.0rc1'],
    ['1.0-1', '1.0.post1'],
    ['v1.2', '1.2'],
  ])('compareVersions_%s_isTheSameAs_%s', (a: string, b: string) => {
    // Act
    const result: number = compareVersions(a, b);

    // Assert
    expect(result).toBe(0);
  });
});

describe('isPrerelease', () => {
  it.each<[string, boolean]>([
    ['1.0', false],
    ['1.0.post2', false],
    ['1.0a1', true],
    ['1.0rc2', true],
    ['1.0.dev3', true],
    ['banana', true],
  ])('isPrerelease_%s_is_%s', (version: string, expected: boolean) => {
    // Act
    const result: boolean = isPrerelease(version);

    // Assert
    expect(result).toBe(expected);
  });
});

describe('newestRelease', () => {
  it('newestRelease_releasesAndPrereleases_skipsThePrereleases', () => {
    // Act
    const newest: string | null = newestRelease(['1.9', '2.0rc1', '1.10', 'junk']);

    // Assert
    expect(newest).toBe('1.10');
  });

  it('newestRelease_onlyPrereleases_answersTheNewestOfThem', () => {
    // Act
    const newest: string | null = newestRelease(['0.1a1', '0.1b2']);

    // Assert
    expect(newest).toBe('0.1b2');
  });

  it('newestRelease_nothingPep440Describes_answersNull', () => {
    // Act
    const newest: string | null = newestRelease(['junk']);

    // Assert
    expect(newest).toBeNull();
  });
});

describe('deriveStatus', () => {
  it.each<[string | null, string | null, string]>([
    [null, '1.0', 'unknown'],
    ['1.0', null, 'unknown'],
    ['junk', '1.0', 'unknown'],
    ['1.0', '1.1', 'outdated'],
    ['1.1', '1.1.0', 'current'],
    ['2.0rc1', '1.9', 'current'],
  ])(
    'deriveStatus_%s_against_%s_is_%s',
    (installed: string | null, latest: string | null, expected: string) => {
      // Act
      const status: string = deriveStatus(installed, latest);

      // Assert
      expect(status).toBe(expected);
    },
  );
});
