import { compareReleaseVersions, deriveStatus } from './versions';

describe('compareReleaseVersions', () => {
  it('orders by release precedence', () => {
    expect(compareReleaseVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareReleaseVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('ignores prerelease and build suffixes', () => {
    expect(compareReleaseVersions('1.2.3-beta', '1.2.3')).toBe(0);
    expect(compareReleaseVersions('1.2.3+build', '1.2.3')).toBe(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareReleaseVersions('1.2', '1.2.0')).toBe(0);
    expect(compareReleaseVersions('1.2.1', '1.2')).toBeGreaterThan(0);
  });
});

describe('deriveStatus', () => {
  it('is unknown when either version is missing', () => {
    expect(deriveStatus(null, '1.0.0')).toBe('unknown');
    expect(deriveStatus('1.0.0', null)).toBe('unknown');
  });

  it('is outdated when the latest is strictly newer', () => {
    expect(deriveStatus('1.0.0', '1.1.0')).toBe('outdated');
  });

  it('is current when installed is at or beyond the latest release', () => {
    expect(deriveStatus('1.1.0', '1.1.0')).toBe('current');
    expect(deriveStatus('2.0.0', '1.9.0')).toBe('current');
  });
});
