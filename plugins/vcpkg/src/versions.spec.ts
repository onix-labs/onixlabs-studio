import { describe, expect, it } from 'vitest';
import { compareVersions, deriveStatus, formatVersion } from './versions';

describe('formatVersion', () => {
  it('formatVersion_portVersionZero_isLeftOff', () => {
    // Arrange
    const version: string = '1.3.1';

    // Act
    const text: string = formatVersion(version, 0);

    // Assert
    expect(text).toBe('1.3.1');
  });

  it('formatVersion_portVersionSet_isWrittenAsVcpkgDoes', () => {
    // Arrange
    const version: string = '1.3.1';

    // Act
    const text: string = formatVersion(version, 3);

    // Assert
    expect(text).toBe('1.3.1#3');
  });
});

describe('compareVersions', () => {
  it('compareVersions_dottedVersions_compareNumerically', () => {
    // Arrange
    const older: string = '10.2.0';
    const newer: string = '10.10.0';

    // Act
    const sign: number = compareVersions(newer, older);

    // Assert
    expect(sign).toBeGreaterThan(0);
  });

  it('compareVersions_samePortVersionDiffers_portVersionDecides', () => {
    // Arrange
    const older: string = '1.3.1';
    const newer: string = '1.3.1#2';

    // Act
    const sign: number = compareVersions(newer, older);

    // Assert
    expect(sign).toBeGreaterThan(0);
  });

  it('compareVersions_dates_compareInOrder', () => {
    // Arrange
    const older: string = '2023-12-31';
    const newer: string = '2024-01-02';

    // Act
    const sign: number = compareVersions(older, newer);

    // Assert
    expect(sign).toBeLessThan(0);
  });

  it('compareVersions_equalVersions_areZero', () => {
    // Arrange
    const version: string = '1.2#1';

    // Act
    const sign: number = compareVersions(version, '1.2.0#1');

    // Assert
    expect(sign).toBe(0);
  });
});

describe('deriveStatus', () => {
  it('deriveStatus_eitherMissing_isUnknown', () => {
    // Arrange
    const latest: string = '1.0';

    // Act
    const status: string = deriveStatus(null, latest);

    // Assert
    expect(status).toBe('unknown');
  });

  it('deriveStatus_latestNewer_isOutdated', () => {
    // Arrange
    const installed: string = '1.3.1';

    // Act
    const status: string = deriveStatus(installed, '1.3.1#1');

    // Assert
    expect(status).toBe('outdated');
  });

  it('deriveStatus_same_isCurrent', () => {
    // Arrange
    const installed: string = '12.0.0';

    // Act
    const status: string = deriveStatus(installed, '12.0.0');

    // Assert
    expect(status).toBe('current');
  });
});
