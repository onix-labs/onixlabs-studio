import { describe, expect, it } from 'vitest';
import { compareVersions, deriveStatus, newestVersion } from './versions';

describe('compareVersions', () => {
  it('compareVersions_numericParts_compareAsNumbers', () => {
    // Arrange
    const older: string = '1.9.0';
    const newer: string = '1.10.0';

    // Act
    const sign: number = compareVersions(newer, older);

    // Assert
    expect(sign).toBeGreaterThan(0);
  });

  it('compareVersions_aPrerelease_sortsBeforeItsRelease', () => {
    // Arrange
    const pre: string = '2.0.0-rc1';
    const release: string = '2.0.0';

    // Act
    const sign: number = compareVersions(pre, release);

    // Assert
    expect(sign).toBeLessThan(0);
  });

  it('compareVersions_buildMetadata_doesNotCount', () => {
    // Arrange
    const built: string = '1.2.3+linux';

    // Act
    const sign: number = compareVersions(built, '1.2.3');

    // Assert
    expect(sign).toBe(0);
  });

  it('compareVersions_cciDates_compareInOrder', () => {
    // Arrange
    const older: string = 'cci.20230101';
    const newer: string = 'cci.20240101';

    // Act
    const sign: number = compareVersions(older, newer);

    // Assert
    expect(sign).toBeLessThan(0);
  });
});

describe('newestVersion', () => {
  it('newestVersion_releasesAndPrereleases_prefersTheNewestRelease', () => {
    // Arrange
    const versions: readonly string[] = ['9.1.0', '12.2.0', '13.0.0-rc1', '10.2.1'];

    // Act
    const newest: string | null = newestVersion(versions);

    // Assert
    expect(newest).toBe('12.2.0');
  });

  it('newestVersion_onlyPrereleases_isTheNewestPrerelease', () => {
    // Arrange
    const versions: readonly string[] = ['1.0.0-a', '1.0.0-b'];

    // Act
    const newest: string | null = newestVersion(versions);

    // Assert
    expect(newest).toBe('1.0.0-b');
  });

  it('newestVersion_none_isNull', () => {
    // Arrange
    const versions: readonly string[] = [];

    // Act
    const newest: string | null = newestVersion(versions);

    // Assert
    expect(newest).toBeNull();
  });
});

describe('deriveStatus', () => {
  it('deriveStatus_latestNewer_isOutdated', () => {
    // Arrange
    const installed: string = '10.2.1';

    // Act
    const status: string = deriveStatus(installed, '12.2.0');

    // Assert
    expect(status).toBe('outdated');
  });

  it('deriveStatus_unresolved_isUnknown', () => {
    // Arrange
    const latest: string = '12.2.0';

    // Act
    const status: string = deriveStatus(null, latest);

    // Assert
    expect(status).toBe('unknown');
  });
});
