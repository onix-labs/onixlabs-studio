import { describe, expect, it } from 'vitest';
import { compareVersions, deriveStatus, floorOf, isPrerelease } from './versions';

describe('compareVersions', () => {
  it('compareVersions_semverPrecedence_ordersReleasesAndPrereleases', () => {
    // Arrange
    const versions: string[] = [
      '1.0.0',
      '1.0.0-rc.10',
      '0.9.9',
      '1.0.0-alpha',
      '1.0.0-rc.2',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.10.0',
      '1.2.0',
    ];

    // Act
    const sorted: string[] = [...versions].sort(compareVersions);

    // Assert
    expect(sorted).toEqual([
      '0.9.9',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.0.0-rc.2',
      '1.0.0-rc.10',
      '1.0.0',
      '1.2.0',
      '1.10.0',
    ]);
  });

  it('compareVersions_buildMetadata_isIgnored', () => {
    // Arrange
    const left: string = '1.0.0+build.1';

    // Act
    const difference: number = compareVersions(left, '1.0.0');

    // Assert
    expect(difference).toBe(0);
  });

  it('compareVersions_somethingNotAVersion_sortsBelowEveryVersion', () => {
    // Arrange
    const odd: string = 'nightly';

    // Act
    const difference: number = compareVersions(odd, '0.0.1');

    // Assert
    expect(difference).toBeLessThan(0);
  });
});

describe('isPrerelease', () => {
  it('isPrerelease_eachForm_saysWhetherItIsOne', () => {
    // Arrange
    const versions: readonly string[] = ['1.0.0-beta.1', '1.0.0', '1.0.0+meta', 'junk'];

    // Act
    const answers: readonly boolean[] = versions.map(isPrerelease);

    // Assert
    expect(answers).toEqual([true, false, false, false]);
  });
});

describe('floorOf', () => {
  it('floorOf_requirements_readTheVersionTheyStartFrom', () => {
    // Arrange
    const requirements: readonly string[] = ['1', '^1.2', '=0.4.1', '>=1, <2', '~0.3.0-rc.1', '*'];

    // Act
    const floors: readonly (string | null)[] = requirements.map(floorOf);

    // Assert
    expect(floors).toEqual(['1.0.0', '1.2.0', '0.4.1', '1.0.0', '0.3.0-rc.1', null]);
  });
});

describe('deriveStatus', () => {
  it('deriveStatus_eachCase_givesTheVerdict', () => {
    // Arrange
    const cases: readonly [string | null, string | null][] = [
      ['1.0.0', '1.1.0'],
      ['1.1.0', '1.1.0'],
      [null, '1.1.0'],
      ['1.0.0', null],
    ];

    // Act
    const verdicts: readonly string[] = cases.map(
      ([installed, latest]: [string | null, string | null]): string =>
        deriveStatus(installed, latest),
    );

    // Assert
    expect(verdicts).toEqual(['outdated', 'current', 'unknown', 'unknown']);
  });
});
