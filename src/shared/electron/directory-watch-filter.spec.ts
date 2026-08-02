import { shouldForwardTreeEvent } from './directory-watch-filter';

describe('shouldForwardTreeEvent', () => {
  it('ordinarySourcePaths_areForwarded', () => {
    expect(shouldForwardTreeEvent('Program.cs')).toBe(true);
    expect(shouldForwardTreeEvent('src/Api/Program.cs')).toBe(true);
    expect(shouldForwardTreeEvent('src/Api/Controllers')).toBe(true);
  });

  it('changesInsideBuildOutputs_areDropped', () => {
    expect(shouldForwardTreeEvent('src/Api/bin/Debug/net9.0/Api.dll')).toBe(false);
    expect(shouldForwardTreeEvent('src/Api/obj/project.assets.json')).toBe(false);
    expect(shouldForwardTreeEvent('.vs/Solution/v17/.suo')).toBe(false);
    expect(shouldForwardTreeEvent('node_modules/pkg/index.js')).toBe(false);
  });

  it('ignoredDirectoryCasing_doesNotMatter', () => {
    expect(shouldForwardTreeEvent('src/Api/Bin/Debug/Api.dll')).toBe(false);
    expect(shouldForwardTreeEvent('src/Api/OBJ/project.assets.json')).toBe(false);
  });

  it('theIgnoredDirectoryEntryItself_isForwarded_soItsParentListingStaysLive', () => {
    expect(shouldForwardTreeEvent('src/Api/bin')).toBe(true);
    expect(shouldForwardTreeEvent('src/Api/obj')).toBe(true);
    expect(shouldForwardTreeEvent('node_modules')).toBe(true);
  });

  it('windowsSeparators_areHandled', () => {
    expect(shouldForwardTreeEvent('src\\Api\\bin\\Debug\\Api.dll')).toBe(false);
    expect(shouldForwardTreeEvent('src\\Api\\Program.cs')).toBe(true);
    expect(shouldForwardTreeEvent('.git\\HEAD')).toBe(true);
  });

  it('gitBookkeepingChurn_isDropped', () => {
    expect(shouldForwardTreeEvent('.git/objects/ab/cdef0123456789')).toBe(false);
    expect(shouldForwardTreeEvent('.git/logs/HEAD')).toBe(false);
    expect(shouldForwardTreeEvent('.git/index.lock')).toBe(false);
    expect(shouldForwardTreeEvent('.git/FETCH_HEAD.lock')).toBe(false);
  });

  it('gitSignalEntries_areForwarded', () => {
    expect(shouldForwardTreeEvent('.git/HEAD')).toBe(true);
    expect(shouldForwardTreeEvent('.git/index')).toBe(true);
    expect(shouldForwardTreeEvent('.git/packed-refs')).toBe(true);
    expect(shouldForwardTreeEvent('.git/MERGE_HEAD')).toBe(true);
    expect(shouldForwardTreeEvent('.git/ORIG_HEAD')).toBe(true);
    expect(shouldForwardTreeEvent('.git/REBASE_HEAD')).toBe(true);
    expect(shouldForwardTreeEvent('.git/refs/heads/main')).toBe(true);
    expect(shouldForwardTreeEvent('.git/refs/remotes/origin/main')).toBe(true);
  });

  it('theGitDirectoryEntryItself_isForwarded', () => {
    expect(shouldForwardTreeEvent('.git')).toBe(true);
  });

  it('nestedRepositories_useTheirOwnGitFilter', () => {
    expect(shouldForwardTreeEvent('vendor/lib/.git/HEAD')).toBe(true);
    expect(shouldForwardTreeEvent('vendor/lib/.git/objects/ab/cd')).toBe(false);
  });

  it('ignoredAncestorsWin_overDeeperGitSignals', () => {
    expect(shouldForwardTreeEvent('node_modules/pkg/.git/HEAD')).toBe(false);
    expect(shouldForwardTreeEvent('bin/repo/.git/refs/heads/main')).toBe(false);
  });
});
