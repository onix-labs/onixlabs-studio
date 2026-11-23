import type { IconSet } from '@shared/api/icon-theme';
import { matchIcon } from './match-icon';

const SET: IconSet = {
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  rootFolder: 'root',
  fileNames: { 'package.json': 'npm', 'system/win.ini': 'system-win' },
  fileExtensions: { ts: 'ts', 'd.ts': 'dts', json: 'json', gitignore: 'git', 'system/ini': 'ini' },
  languageIds: { typescript: 'language', cobol: 'cobol' },
  folderNames: { src: 'src' },
  folderNamesExpanded: { src: 'src-open' },
};

describe('matchIcon', () => {
  it.each([
    ['/a/package.json', 'npm'],
    ['/a/PACKAGE.JSON', 'npm'],
    ['/a/other.json', 'json'],
    ['/a/main.ts', 'ts'],
    ['/a/main.d.ts', 'dts'],
    ['/a/main.spec.ts', 'ts'],
    ['/a/.gitignore', 'git'],
    ['/system/win.ini', 'system-win'],
    ['C:\\system\\win.ini', 'system-win'],
    ['/system/other.ini', 'ini'],
    ['/elsewhere/other.ini', 'file'],
    ['/a/Makefile', 'file'],
    ['main.ts', 'ts'],
    ['/a/constructor', 'file'],
    ['/a/x.constructor', 'file'],
  ])('file_%s_is_%s', (path: string, expected: string) => {
    expect(matchIcon(SET, { path, kind: 'file' })).toBe(expected);
  });

  it('file_aSolutionFormatTheThemePredates_isDrawnAsASolution', () => {
    const extensions: IconSet = { ...SET, fileExtensions: { sln: 'sln' } };

    expect(matchIcon(extensions, { path: '/a/App.slnx', kind: 'file', named: true })).toBe('sln');
    expect(
      matchIcon(
        { ...extensions, fileExtensions: { sln: 'sln', slnx: 'slnx' } },
        { path: '/a/App.slnx', kind: 'file' },
      ),
    ).toBe('slnx');
  });

  it('file_matchesItsLanguage_onlyWhenNeitherNameNorExtensionDoes', () => {
    expect(matchIcon(SET, { path: 'a.cbl', kind: 'file', language: 'cobol' })).toBe('cobol');
    expect(matchIcon(SET, { path: 'a.ts', kind: 'file', language: 'typescript' })).toBe('ts');
  });

  it('file_whenOnlyNamedRulesCount_skipsTheDefault', () => {
    expect(matchIcon(SET, { path: 'a.sln', kind: 'file', named: true })).toBeUndefined();
    expect(matchIcon(SET, { path: 'a.ts', kind: 'file', named: true })).toBe('ts');
  });

  it.each([
    ['src', false, 'src'],
    ['src', true, 'src-open'],
    ['lib', false, 'folder'],
    ['lib', true, 'folder-open'],
  ])('folder_%s_expanded_%s_is_%s', (path: string, expanded: boolean, expected: string) => {
    expect(matchIcon(SET, { path, kind: 'folder', expanded })).toBe(expected);
  });

  it('root_usesTheRootPicture_expandedOrNot', () => {
    expect(matchIcon(SET, { path: '/ws', kind: 'root' })).toBe('root');
    expect(matchIcon(SET, { path: '/ws', kind: 'root', expanded: true })).toBe('root');
  });
});
