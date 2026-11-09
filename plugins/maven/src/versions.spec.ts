import { describe, expect, it } from 'vitest';
import {
  compareMavenVersions,
  deriveStatus,
  isConcreteVersion,
  isPrerelease,
  pickLatest,
} from './versions';

describe('compareMavenVersions', () => {
  it('compareMavenVersions_qualifiers_orderAsMavenDoes', () => {
    const ordered: readonly string[] = [
      '1.0-alpha-1',
      '1.0-beta',
      '1.0-M2',
      '1.0-RC1',
      '1.0-SNAPSHOT',
      '1.0',
      '1.0-sp1',
      '1.0.1',
    ];

    for (let index: number = 1; index < ordered.length; index += 1) {
      expect(compareMavenVersions(ordered[index], ordered[index - 1])).toBeGreaterThan(0);
    }
  });

  it('compareMavenVersions_trailingZerosAndReleaseWords_areEqual', () => {
    expect(compareMavenVersions('1.0', '1')).toBe(0);
    expect(compareMavenVersions('5.6.15.Final', '5.6.15')).toBe(0);
  });

  it('compareMavenVersions_numbers_compareNumerically', () => {
    expect(compareMavenVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });
});

describe('isPrerelease', () => {
  it('isPrerelease_prereleaseWords_areDetected', () => {
    expect(
      ['1.0-RC1', '2.0.0-beta.1', '3.0-SNAPSHOT', '1.0-M3', '21-ea', '1.0-preview'].every(
        isPrerelease,
      ),
    ).toBe(true);
  });

  it('isPrerelease_releasesAndFlavours_areNot', () => {
    expect(['1.0', '33.0.0-jre', '5.6.15.Final', '2.5.RELEASE'].some(isPrerelease)).toBe(false);
  });
});

describe('isConcreteVersion', () => {
  it('isConcreteVersion_rangesDynamicAndReferences_areNot', () => {
    expect(
      ['[1.0,2.0)', '1.+', 'latest.release', '${jackson.version}', ''].some(isConcreteVersion),
    ).toBe(false);
    expect(isConcreteVersion('2.17.0')).toBe(true);
  });
});

describe('pickLatest', () => {
  it('pickLatest_skipsPrereleasesUnlessAsked', () => {
    const versions: readonly string[] = ['1.0', '1.1', '2.0-RC1'];

    expect(pickLatest(versions, '1.0', false)).toBe('1.1');
    expect(pickLatest(versions, '1.0', true)).toBe('2.0-RC1');
  });

  it('pickLatest_keepsToTheProjectsFlavour', () => {
    const versions: readonly string[] = [
      '32.0.0-jre',
      '32.0.0-android',
      '33.0.0-jre',
      '33.0.0-android',
    ];

    expect(pickLatest(versions, '32.0.0-android', false)).toBe('33.0.0-android');
    expect(pickLatest(versions, null, false)).toBe('33.0.0-jre');
  });

  it('pickLatest_nothingQualifies_answersNull', () => {
    expect(pickLatest(['1.0-SNAPSHOT'], null, false)).toBeNull();
  });
});

describe('deriveStatus', () => {
  it('deriveStatus_comparesConcreteVersions', () => {
    expect(deriveStatus('1.0', '1.1')).toBe('outdated');
    expect(deriveStatus('1.1', '1.1')).toBe('current');
    expect(deriveStatus('[1,2)', '1.1')).toBe('unknown');
    expect(deriveStatus(null, '1.1')).toBe('unknown');
    expect(deriveStatus('1.0', null)).toBe('unknown');
  });
});
