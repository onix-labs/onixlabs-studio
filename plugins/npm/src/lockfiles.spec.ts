import { describe, expect, it } from 'vitest';
import { readPnpmLock, readYarnLock } from './lockfiles';

describe('readPnpmLock', () => {
  it('readsTheFormatOfLockfileV9', () => {
    const text: string = [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '',
      '  .:',
      '    dependencies:',
      '      a:',
      '        specifier: ^1.0.0',
      '        version: 1.2.3',
      '',
      'packages:',
      '',
      '  a@1.2.3:',
      '    resolution: {integrity: sha512-x}',
      '',
      "  '@scope/b@2.0.0':",
      '    resolution: {integrity: sha512-y}',
      '',
      'snapshots:',
      '',
      '  c@9.9.9:',
      '    dependencies: {}',
    ].join('\n');

    expect([...readPnpmLock(text)]).toEqual([
      ['a', '1.2.3'],
      ['@scope/b', '2.0.0'],
    ]);
  });

  it('readsTheOlderFormats', () => {
    const text: string = [
      'packages:',
      '  /a@1.2.3:',
      '    dev: false',
      '  /@scope/b/2.0.0:',
      '    dev: false',
    ].join('\n');

    expect([...readPnpmLock(text)]).toEqual([
      ['a', '1.2.3'],
      ['@scope/b', '2.0.0'],
    ]);
  });

  it('leavesOffAPeerSuffix', () => {
    expect(readPnpmLock('packages:\n  a@1.2.3(react@18.0.0):\n').get('a')).toBe('1.2.3');
  });

  it('keepsTheHighestOfSeveralVersions', () => {
    expect(readPnpmLock('packages:\n  a@1.0.0:\n  a@2.0.0:\n  a@1.5.0:\n').get('a')).toBe('2.0.0');
  });

  it('readsNothingFromTextWithNoPackages', () => {
    expect(readPnpmLock('lockfileVersion: 9').size).toBe(0);
  });
});

describe('readYarnLock', () => {
  it('readsTheClassicFormat', () => {
    const text: string = [
      '# yarn lockfile v1',
      '',
      'a@^1.0.0, a@^1.2.0:',
      '  version "1.2.3"',
      '  resolved "https://registry.example/a.tgz"',
      '',
      '"@scope/b@^2.0.0":',
      '  version "2.0.0"',
    ].join('\n');

    expect([...readYarnLock(text)]).toEqual([
      ['a', '1.2.3'],
      ['@scope/b', '2.0.0'],
    ]);
  });

  it('readsTheBerryFormat', () => {
    const text: string = [
      '__metadata:',
      '  version: 8',
      '',
      '"a@npm:^1.0.0":',
      '  version: 1.2.3',
      '  resolution: "a@npm:1.2.3"',
    ].join('\n');

    expect([...readYarnLock(text)]).toEqual([['a', '1.2.3']]);
  });

  it('keepsTheHighestOfSeveralVersions', () => {
    const text: string = 'a@^1.0.0:\n  version "1.5.0"\n\na@^2.0.0:\n  version "2.1.0"\n';

    expect(readYarnLock(text).get('a')).toBe('2.1.0');
  });

  it('readsNothingFromEmptyText', () => {
    expect(readYarnLock('').size).toBe(0);
  });
});
