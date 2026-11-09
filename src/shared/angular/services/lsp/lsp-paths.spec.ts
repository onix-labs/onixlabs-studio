import {
  basename,
  isGeneratedView,
  isMetadataAsSource,
  isToolchainSource,
  isWithin,
  normalise,
  parentDir,
  pathToUri,
  uriToPath,
} from './lsp-paths';

describe('lsp-paths', () => {
  it('normalise_forwardSlashesAndLowerCasesTheDriveLetter', () => {
    expect(normalise('C:\\Users\\x')).toBe('c:/Users/x');
    expect(normalise('/home/x')).toBe('/home/x');
  });

  it('pathToUri_buildsAFileUriWithEncodedSpaces', () => {
    expect(pathToUri('/home/a b.ts')).toBe('file:///home/a%20b.ts');
    expect(pathToUri('C:/x.ts')).toBe('file:///C:/x.ts');
  });

  it('uriToPath_stripsSchemeAndLeadingSlashBeforeADriveLetter', () => {
    expect(uriToPath('file:///home/x.ts')).toBe('/home/x.ts');
    expect(uriToPath('file:///C:/x.ts')).toBe('C:/x.ts');
  });

  it('basename_returnsTheFinalSegment', () => {
    expect(basename('/a/b/c.ts')).toBe('c.ts');
  });

  it('parentDir_returnsTheForwardSlashedParent', () => {
    expect(parentDir('/a/b/c.ts')).toBe('/a/b');
    expect(parentDir('a\\b\\c.ts')).toBe('a/b');
  });

  it('isWithin_matchesTheRootAndItsDescendants', () => {
    expect(isWithin('/root/a.ts', '/root')).toBe(true);
    expect(isWithin('/root', '/root')).toBe(true);
    expect(isWithin('/other/a.ts', '/root')).toBe(false);
  });
});

describe('isGeneratedView (#1210, #1213)', () => {
  it('isAViewStudioWrote_amongTheDecompiledSources_butNotADecompiledSource', () => {
    const view: string = '/private/var/T/MetadataAsSource/StudioViews/0b1c/square! expanded.rs';
    const decompiled: string = '/private/var/T/MetadataAsSource/1a2b/IList.cs';

    expect(isGeneratedView(view)).toBe(true);
    // It opens read-only by the rule for decompiled sources, which is why it lives among them.
    expect(isMetadataAsSource(view)).toBe(true);
    expect(isGeneratedView(decompiled)).toBe(false);
    expect(
      isGeneratedView(
        'C:\\Users\\me\\AppData\\Local\\Temp\\MetadataAsSource\\StudioViews\\1\\a.txt',
      ),
    ).toBe(true);
  });
});

describe('isToolchainSource (#1210)', () => {
  it.each([
    '/u/.rustup/toolchains/stable/lib/rustlib/src/rust/library/core/src/option.rs',
    '/u/.cargo/registry/src/index.crates.io-abc/serde-1.0.0/src/lib.rs',
    '/u/.cargo/git/checkouts/thing-abc/def/src/lib.rs',
  ])('takes %s', (path: string) => {
    expect(isToolchainSource(path)).toBe(true);
  });

  it.each(['/u/project/src/lib.rs', '/u/.cargo/registry/src/a/Cargo.toml', '/u/.cargo/config.rs'])(
    'refuses %s',
    (path: string) => {
      expect(isToolchainSource(path)).toBe(false);
    },
  );
});
