import { describe, expect, it } from 'vitest';
import { compareStudioVersions, isNewerStudioVersion } from './studio-version';

/**
 * Asserts that a list of versions is in strictly ascending precedence order, checking every adjacent
 * pair in both directions so an asymmetric comparator cannot pass.
 * @param versions The versions, expected oldest first.
 */
function expectAscending(versions: readonly string[]): void {
  for (let index: number = 1; index < versions.length; index += 1) {
    const older: string = versions[index - 1];
    const newer: string = versions[index];
    expect(compareStudioVersions(older, newer), `${older} < ${newer}`).toBeLessThan(0);
    expect(compareStudioVersions(newer, older), `${newer} > ${older}`).toBeGreaterThan(0);
  }
}

describe('compareStudioVersions', (): void => {
  it('orders a full release line, prereleases before the release they lead to', (): void => {
    expectAscending([
      '2026.1.0-beta.3',
      '2026.1.0-beta.4',
      '2026.1.0-beta.5',
      '2026.1.0',
      '2026.1.1',
      '2026.2.0',
      '2027.1.0',
    ]);
  });

  it('orders prerelease numbers numerically, not lexically', (): void => {
    // The regression this comparator exists to prevent: lexically, '10' precedes '9'.
    expectAscending(['2026.1.0-beta.9', '2026.1.0-beta.10', '2026.1.0-beta.11']);
  });

  it('ranks a prerelease below the release with the same core', (): void => {
    expect(compareStudioVersions('2026.1.0-beta.4', '2026.1.0')).toBeLessThan(0);
    expect(compareStudioVersions('2026.1.0', '2026.1.0-beta.4')).toBeGreaterThan(0);
  });

  it('orders prerelease channels against each other', (): void => {
    expectAscending(['2026.1.0-alpha.1', '2026.1.0-beta.1', '2026.1.0-rc.1', '2026.1.0']);
  });

  it('ranks a numeric identifier below an alphanumeric one', (): void => {
    expect(compareStudioVersions('2026.1.0-beta.1', '2026.1.0-beta.final')).toBeLessThan(0);
  });

  it('ranks a shorter identifier list below a longer one that extends it', (): void => {
    expect(compareStudioVersions('2026.1.0-beta', '2026.1.0-beta.1')).toBeLessThan(0);
  });

  it('reports equal versions as equal, whatever their shape', (): void => {
    expect(compareStudioVersions('2026.1.0', '2026.1.0')).toBe(0);
    expect(compareStudioVersions('2026.1.0-beta.4', '2026.1.0-beta.4')).toBe(0);
  });

  it('ignores build metadata, which carries no precedence', (): void => {
    expect(compareStudioVersions('2026.1.0+abc1234', '2026.1.0')).toBe(0);
    expect(compareStudioVersions('2026.1.0-beta.4+abc1234', '2026.1.0-beta.4')).toBe(0);
  });

  it('tolerates a leading v prefix', (): void => {
    expect(compareStudioVersions('v2026.1.0-beta.4', '2026.1.0-beta.4')).toBe(0);
    expect(compareStudioVersions('v2026.1.0', 'v2026.1.0-beta.4')).toBeGreaterThan(0);
  });

  it('treats a missing core part as zero, so shapes of differing length still order', (): void => {
    expect(compareStudioVersions('2026.1', '2026.1.0')).toBe(0);
    expect(compareStudioVersions('2026.1', '2026.1.1')).toBeLessThan(0);
  });

  it('degrades to a best-effort ordering rather than throwing on malformed input', (): void => {
    // A version string comes from the build's own metadata, so a malformed one is a packaging
    // accident. It must not throw somewhere the user cannot act on it.
    expect((): number => compareStudioVersions('', '2026.1.0')).not.toThrow();
    expect(compareStudioVersions('', '')).toBe(0);
    expect(compareStudioVersions('not-a-version', '2026.1.0')).toBeLessThan(0);
  });
});

describe('isNewerStudioVersion', (): void => {
  it('is true only for a strictly higher precedence', (): void => {
    expect(isNewerStudioVersion('2026.1.0-beta.5', '2026.1.0-beta.4')).toBe(true);
    expect(isNewerStudioVersion('2026.1.0-beta.4', '2026.1.0-beta.4')).toBe(false);
    expect(isNewerStudioVersion('2026.1.0-beta.3', '2026.1.0-beta.4')).toBe(false);
  });
});
