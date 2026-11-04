import { parseInitialFiles, RepositoryFile, repositoryFiles } from './repository-files';

describe('repositoryFiles', () => {
  it('buildsWhatWasChosen', () => {
    const files: readonly RepositoryFile[] = repositoryFiles(
      { gitignore: 'rust', licence: 'mit', readme: true, commit: true },
      'demo',
      2026,
    );

    expect(files.map((file: RepositoryFile): string => file.name)).toEqual([
      '.gitignore',
      'LICENSE',
      'README.md',
    ]);
    expect(files[1].text).toContain('Copyright (c) 2026 demo contributors');
    expect(files[2].text).toBe('# demo\n');
  });

  it('buildsNothingWhenNothingWasChosen', () => {
    expect(repositoryFiles({ readme: false, commit: true }, 'demo', 2026)).toEqual([]);
  });
});

describe('parseInitialFiles', () => {
  it('dropsAnythingThatNamesNoTemplate', () => {
    expect(
      parseInitialFiles({
        gitignore: 'constructor',
        licence: '../evil',
        readme: true,
        commit: 'yes',
      }),
    ).toEqual({ readme: true, commit: false });
  });

  it('keepsTheTemplatesItKnows', () => {
    expect(parseInitialFiles({ gitignore: 'node', licence: 'isc', commit: true })).toEqual({
      gitignore: 'node',
      licence: 'isc',
      readme: false,
      commit: true,
    });
  });

  it('readsNothingFromWhatIsNotAChoice', () => {
    expect(parseInitialFiles(undefined)).toBeUndefined();
  });
});
