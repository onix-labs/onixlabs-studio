import { describe, expect, it } from 'vitest';
import { GoModFile, GoWorkFile, parseGoMod, parseGoSum, parseGoWork } from './gomod';

describe('parseGoMod', () => {
  it('parseGoMod_singleLineAndBlockRequires_readsEachWithItsIndirectMark', () => {
    // Arrange
    const text: string = [
      'module example.com/app',
      '',
      'go 1.22',
      '',
      'require golang.org/x/mod v0.20.0',
      '',
      'require (',
      '\tgithub.com/BurntSushi/toml v1.3.2',
      '\tgolang.org/x/sys v0.21.0 // indirect',
      '\tgolang.org/x/text v0.16.0 // indirect; needed by x/net',
      '\tgithub.com/a/b v1.0.0 // not indirect',
      ')',
    ].join('\n');

    // Act
    const file: GoModFile = parseGoMod(text);

    // Assert
    expect(file.module).toBe('example.com/app');
    expect(file.requires).toEqual([
      { path: 'golang.org/x/mod', version: 'v0.20.0', indirect: false },
      { path: 'github.com/BurntSushi/toml', version: 'v1.3.2', indirect: false },
      { path: 'golang.org/x/sys', version: 'v0.21.0', indirect: true },
      { path: 'golang.org/x/text', version: 'v0.16.0', indirect: true },
      { path: 'github.com/a/b', version: 'v1.0.0', indirect: false },
    ]);
  });

  it('parseGoMod_replaceForms_readsVersionSpecificWildcardAndDirectory', () => {
    // Arrange
    const text: string = [
      'module m',
      'replace example.com/a v1.0.0 => example.com/fork v1.0.1',
      'replace (',
      '  example.com/b => ../b',
      '  example.com/c => example.com/c2 v2.0.0',
      ')',
      'replace example.com/broken =>',
    ].join('\n');

    // Act
    const file: GoModFile = parseGoMod(text);

    // Assert
    expect(file.replaces).toEqual([
      {
        path: 'example.com/a',
        version: 'v1.0.0',
        newPath: 'example.com/fork',
        newVersion: 'v1.0.1',
      },
      { path: 'example.com/b', version: null, newPath: '../b', newVersion: null },
      { path: 'example.com/c', version: null, newPath: 'example.com/c2', newVersion: 'v2.0.0' },
    ]);
  });

  it('parseGoMod_excludes_areRead', () => {
    // Arrange
    const text: string =
      'module m\nexclude (\n  example.com/a v1.1.0\n)\nexclude example.com/b v0.2.0\n';

    // Act
    const file: GoModFile = parseGoMod(text);

    // Assert
    expect(file.excludes).toEqual([
      { path: 'example.com/a', version: 'v1.1.0' },
      { path: 'example.com/b', version: 'v0.2.0' },
    ]);
  });

  it('parseGoMod_quotedArgumentsAndComments_areUnquotedAndIgnored', () => {
    // Arrange
    const text: string = [
      '// a header comment',
      'module "example.com/quoted"',
      'require `example.com/raw` v1.0.0',
      'require "example.com/esc\\"aped" v1.0.0',
      'replace example.com/x => "../dir with space"',
    ].join('\r\n');

    // Act
    const file: GoModFile = parseGoMod(text);

    // Assert
    expect(file.module).toBe('example.com/quoted');
    expect(file.requires.map((requirement: { path: string }): string => requirement.path)).toEqual([
      'example.com/raw',
      'example.com/esc"aped',
    ]);
    expect(file.replaces[0].newPath).toBe('../dir with space');
  });

  it('parseGoMod_emptyBlockAndUnclosedString_areSkippedNotFatal', () => {
    // Arrange
    const text: string =
      'require ()\nrequire "example.com/open v1.0.0\nrequire example.com/ok v1.0.0\n';

    // Act
    const file: GoModFile = parseGoMod(text);

    // Assert
    expect(file.module).toBeNull();
    expect(file.requires).toEqual([{ path: 'example.com/ok', version: 'v1.0.0', indirect: false }]);
  });

  it('parseGoMod_byteOrderMark_isReadPast', () => {
    expect(parseGoMod('\uFEFFmodule example.com/bom\n').module).toBe('example.com/bom');
  });
});

describe('parseGoWork', () => {
  it('parseGoWork_usesAndReplaces_areRead', () => {
    // Arrange
    const text: string = [
      'go 1.22',
      'use ./tools',
      'use (',
      '\t./api',
      '\t"./web app" // a quoted directory',
      ')',
      'replace example.com/a => example.com/a v1.2.0',
    ].join('\n');

    // Act
    const file: GoWorkFile = parseGoWork(text);

    // Assert
    expect(file.uses).toEqual(['./tools', './api', './web app']);
    expect(file.replaces).toEqual([
      { path: 'example.com/a', version: null, newPath: 'example.com/a', newVersion: 'v1.2.0' },
    ]);
  });
});

describe('parseGoSum', () => {
  it('parseGoSum_codeAndGoModLines_bothRecordTheVersion', () => {
    // Arrange
    const text: string = [
      'golang.org/x/mod v0.20.0 h1:abc=',
      'golang.org/x/mod v0.20.0/go.mod h1:def=',
      'golang.org/x/sys v0.21.0/go.mod h1:ghi=',
      'not a line',
    ].join('\n');

    // Act
    const sums: ReadonlySet<string> = parseGoSum(text);

    // Assert
    expect([...sums].sort()).toEqual(['golang.org/x/mod@v0.20.0', 'golang.org/x/sys@v0.21.0']);
  });
});
