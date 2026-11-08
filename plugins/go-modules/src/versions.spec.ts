import { describe, expect, it } from 'vitest';
import { compareGoVersions, deriveStatus, isGoVersion, isPrerelease, pickLatest } from './versions';

describe('compareGoVersions', () => {
  it('compareGoVersions_releaseCores_orderNumerically', () => {
    // Arrange, Act, Assert
    expect(compareGoVersions('v2.0.0', 'v1.9.9')).toBeGreaterThan(0);
    expect(compareGoVersions('v1.2.0', 'v1.10.0')).toBeLessThan(0);
    expect(compareGoVersions('v1.2.3', 'v1.2.3')).toBe(0);
  });

  it('compareGoVersions_prerelease_ordersBelowItsRelease', () => {
    expect(compareGoVersions('v1.0.0-rc.1', 'v1.0.0')).toBeLessThan(0);
    expect(compareGoVersions('v1.0.0-rc.2', 'v1.0.0-rc.10')).toBeLessThan(0);
    expect(compareGoVersions('v1.0.0-alpha', 'v1.0.0-alpha.1')).toBeLessThan(0);
  });

  it('compareGoVersions_pseudoVersionAfterATag_ordersBetweenItAndTheNext', () => {
    // Arrange
    const pseudo: string = 'v1.2.4-0.20231010123456-abcdef123456';

    // Act, Assert
    expect(compareGoVersions(pseudo, 'v1.2.3')).toBeGreaterThan(0);
    expect(compareGoVersions(pseudo, 'v1.2.4')).toBeLessThan(0);
  });

  it('compareGoVersions_incompatibleBuildSuffix_doesNotTakePart', () => {
    expect(compareGoVersions('v2.0.0+incompatible', 'v2.0.0')).toBe(0);
  });

  it('compareGoVersions_notAVersion_ordersBelowEveryVersion', () => {
    expect(compareGoVersions('garbage', 'v0.0.1')).toBeLessThan(0);
    expect(compareGoVersions('v0.0.1', 'garbage')).toBeGreaterThan(0);
  });
});

describe('isGoVersion', () => {
  it('isGoVersion_shapes_needTheLeadingV', () => {
    expect(isGoVersion('v1.2.3')).toBe(true);
    expect(isGoVersion('1.2.3')).toBe(false);
    expect(isGoVersion('v1.2')).toBe(false);
    expect(isGoVersion('latest')).toBe(false);
  });

  it('isPrerelease_pseudoVersion_isOne', () => {
    expect(isPrerelease('v0.0.0-20231010123456-abcdef123456')).toBe(true);
    expect(isPrerelease('v1.0.0')).toBe(false);
  });
});

describe('pickLatest', () => {
  it('pickLatest_releasesAndPrereleases_choosesTheHighestRelease', () => {
    // Arrange
    const versions: readonly string[] = ['v1.0.0', 'v1.3.0', 'v1.4.0-rc.1', 'v1.2.0', ''];

    // Act
    const latest: string | null = pickLatest(versions, new Set<string>(), null);

    // Assert
    expect(latest).toBe('v1.3.0');
  });

  it('pickLatest_onlyPrereleases_choosesTheHighestPrerelease', () => {
    expect(pickLatest(['v0.1.0-beta', 'v0.1.0-alpha'], new Set<string>(), null)).toBe(
      'v0.1.0-beta',
    );
  });

  it('pickLatest_excludedVersion_isNeverChosen', () => {
    expect(pickLatest(['v1.0.0', 'v1.1.0'], new Set<string>(['v1.1.0']), null)).toBe('v1.0.0');
  });

  it('pickLatest_incompatibleTags_areSkippedForAModuleThatHasCompatibleOnes', () => {
    // Arrange
    const versions: readonly string[] = ['v1.5.0', 'v2.0.0+incompatible'];

    // Act, Assert
    expect(pickLatest(versions, new Set<string>(), 'v1.4.0')).toBe('v1.5.0');
    expect(pickLatest(versions, new Set<string>(), 'v2.0.0+incompatible')).toBe(
      'v2.0.0+incompatible',
    );
    expect(pickLatest(['v2.0.0+incompatible'], new Set<string>(), null)).toBe(
      'v2.0.0+incompatible',
    );
  });

  it('pickLatest_emptyList_isNull', () => {
    expect(pickLatest([], new Set<string>(), null)).toBeNull();
  });
});

describe('deriveStatus', () => {
  it('deriveStatus_eitherMissing_isUnknown', () => {
    expect(deriveStatus(null, 'v1.0.0')).toBe('unknown');
    expect(deriveStatus('v1.0.0', null)).toBe('unknown');
  });

  it('deriveStatus_latestNewer_isOutdated', () => {
    expect(deriveStatus('v1.0.0', 'v1.1.0')).toBe('outdated');
    expect(deriveStatus('v1.0.0-rc.1', 'v1.0.0')).toBe('outdated');
  });

  it('deriveStatus_pseudoVersionAheadOfTheTag_isCurrent', () => {
    expect(deriveStatus('v1.2.4-0.20231010123456-abcdef123456', 'v1.2.3')).toBe('current');
  });
});
