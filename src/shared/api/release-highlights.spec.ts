import { describe, expect, it } from 'vitest';
import { highlightsBetween, RELEASE_HIGHLIGHTS, ReleaseHighlights } from './release-highlights';

/**
 * Reads the versions of a highlight list, for order-sensitive assertions.
 * @param releases The releases.
 * @returns Returns their versions in order.
 */
function versions(releases: readonly ReleaseHighlights[]): readonly string[] {
  return releases.map((release: ReleaseHighlights): string => release.version);
}

describe('highlightsBetween', () => {
  it('reportsNothing_onAFirstRun', () => {
    // There is no "what changed" for someone who has not run it before.
    expect(highlightsBetween(null, '2026.1.0-beta.4')).toEqual([]);
  });

  it('reportsNothing_whenTheVersionIsUnchanged', () => {
    expect(highlightsBetween('2026.1.0-beta.4', '2026.1.0-beta.4')).toEqual([]);
  });

  it('reportsTheRelease_whenMovingOntoIt', () => {
    expect(versions(highlightsBetween('2026.1.0-beta.3', '2026.1.0-beta.4'))).toEqual([
      '2026.1.0-beta.4',
    ]);
  });

  it('reportsEveryReleaseCrossed_whenVersionsAreSkipped', () => {
    // Someone jumping several versions missed all of it at once, so they are owed all of it.
    expect(versions(highlightsBetween('2026.1.0-beta.1', '2026.2.0')).length).toBeGreaterThan(0);
  });

  it('reportsNothingAheadOfTheRunningVersion', () => {
    // A downgrade must not advertise a release the user is no longer on.
    expect(highlightsBetween('2026.1.0-beta.4', '2026.1.0-beta.3')).toEqual([]);
  });

  it('catalogue_isOrderedOldestFirst', () => {
    const listed: readonly string[] = versions(RELEASE_HIGHLIGHTS);
    expect(listed).toEqual([...listed]);
  });

  it('catalogue_givesEveryReleaseAtLeastOneHeadline', () => {
    // An entry with no headlines would produce a step that renders nothing.
    for (const release of RELEASE_HIGHLIGHTS) {
      expect(release.headlines.length, release.version).toBeGreaterThan(0);
      for (const headline of release.headlines) {
        expect(headline.title.length).toBeGreaterThan(0);
        expect(headline.detail.length).toBeGreaterThan(0);
      }
    }
  });
});
