import {
  DEFAULT_POLLING_INTERVAL,
  findPollingFolder,
  isCaseInsensitivePlatform,
  isWithinFolder,
  normalisePollingFolder,
  sanitizePollingFolders,
  sanitizePollingInterval,
} from './polling-folders';

describe('normalisePollingFolder', () => {
  it('stripsTrailingAndRepeatedSeparators', () => {
    expect(normalisePollingFolder('/Volumes/Share/')).toBe('/Volumes/Share');
    expect(normalisePollingFolder('/Volumes//Share///')).toBe('/Volumes/Share');
    expect(normalisePollingFolder('  /mnt/nfs  ')).toBe('/mnt/nfs');
  });

  it('resolvesDotSegments', () => {
    expect(normalisePollingFolder('/mnt/./nfs/../share')).toBe('/mnt/share');
  });

  it('keepsARoot', () => {
    expect(normalisePollingFolder('/')).toBe('/');
    expect(normalisePollingFolder('C:\\')).toBe('C:\\');
  });

  it('keepsWindowsPathsInTheirOwnSeparator', () => {
    expect(normalisePollingFolder('Z:\\projects\\')).toBe('Z:\\projects');
    expect(normalisePollingFolder('\\\\server\\share\\code\\')).toBe('\\\\server\\share\\code');
  });

  it('refusesRelativePathsAndBareUncServers', () => {
    expect(normalisePollingFolder('projects/site')).toBe('');
    expect(normalisePollingFolder('')).toBe('');
    expect(normalisePollingFolder('\\\\server')).toBe('');
    expect(normalisePollingFolder('/a\nb')).toBe('');
  });
});

describe('sanitizePollingFolders', () => {
  it('dropsNonStrings_blanks_andDuplicates_inOrder', () => {
    expect(
      sanitizePollingFolders(['/mnt/b', 3, '', '/mnt/a/', '/mnt/b/', 'relative', '/mnt/a']),
    ).toEqual(['/mnt/b', '/mnt/a']);
  });

  it('returnsNothingForANonArray', () => {
    expect(sanitizePollingFolders('/mnt/a')).toEqual([]);
    expect(sanitizePollingFolders(undefined)).toEqual([]);
  });
});

describe('sanitizePollingInterval', () => {
  it('keepsAnOfferedInterval_andDefaultsOtherwise', () => {
    expect(sanitizePollingInterval(10)).toBe(10);
    expect(sanitizePollingInterval(3)).toBe(DEFAULT_POLLING_INTERVAL);
    expect(sanitizePollingInterval('5')).toBe(DEFAULT_POLLING_INTERVAL);
  });
});

describe('isWithinFolder', () => {
  it('matchesTheFolderItselfAndAnythingInside', () => {
    expect(isWithinFolder('/Volumes/Share', '/Volumes/Share', false)).toBe(true);
    expect(isWithinFolder('/Volumes/Share/site/index.html', '/Volumes/Share', false)).toBe(true);
  });

  it('ignoresTrailingSlashesOnEitherSide', () => {
    expect(isWithinFolder('/Volumes/Share/', '/Volumes/Share', false)).toBe(true);
    expect(isWithinFolder('/Volumes/Share/site', '/Volumes/Share/', false)).toBe(true);
    expect(isWithinFolder('/Volumes/Share//site/', '/Volumes/Share///', false)).toBe(true);
  });

  it('doesNotMatchASiblingSharingAPrefix', () => {
    expect(isWithinFolder('/Volumes/Shared', '/Volumes/Share', false)).toBe(false);
    expect(isWithinFolder('/Volumes', '/Volumes/Share', false)).toBe(false);
  });

  it('ignoresCaseOnlyWhereThePlatformDoes', () => {
    expect(isWithinFolder('/volumes/share/site', '/Volumes/Share', true)).toBe(true);
    expect(isWithinFolder('/volumes/share/site', '/Volumes/Share', false)).toBe(false);
  });

  it('matchesWindowsPathsWithEitherSeparator', () => {
    expect(isWithinFolder('z:/projects/site', 'Z:\\Projects', true)).toBe(true);
    expect(isWithinFolder('\\\\server\\share\\code', '//server/share', true)).toBe(true);
  });

  it('matchesEverythingUnderARoot', () => {
    expect(isWithinFolder('/mnt/anything', '/', false)).toBe(true);
  });

  it('neverMatchesARelativePath', () => {
    expect(isWithinFolder('share/site', '/share', false)).toBe(false);
  });
});

describe('findPollingFolder', () => {
  it('returnsTheFolderAPathLiesIn', () => {
    expect(findPollingFolder('/mnt/nfs/site', ['/Volumes/Share', '/mnt/nfs'], false)).toBe(
      '/mnt/nfs',
    );
    expect(findPollingFolder('/Users/me/site', ['/Volumes/Share'], false)).toBeUndefined();
  });
});

describe('isCaseInsensitivePlatform', () => {
  it('isTrueOnMacOsAndWindowsOnly', () => {
    expect(isCaseInsensitivePlatform('darwin')).toBe(true);
    expect(isCaseInsensitivePlatform('win32')).toBe(true);
    expect(isCaseInsensitivePlatform('linux')).toBe(false);
  });
});
