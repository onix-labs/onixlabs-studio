import { MetadataPolicies, shouldForwardTreeEvent } from './directory-watch-filter';

/**
 * The Git plugin's metadata policy, as its manifest declares it (#817).
 */
const GIT: MetadataPolicies = new Map<string, readonly string[]>([
  ['.git', ['HEAD', '*_HEAD', 'index', 'packed-refs', 'refs/**']],
]);

/**
 * Filters a path with the Git plugin installed.
 * @param path The changed path.
 * @returns Returns whether it is forwarded.
 */
function forward(path: string): boolean {
  return shouldForwardTreeEvent(path, GIT);
}

describe('shouldForwardTreeEvent', () => {
  it('ordinarySourcePaths_areForwarded', () => {
    expect(forward('Program.cs')).toBe(true);
    expect(forward('src/Api/Program.cs')).toBe(true);
    expect(forward('src/Api/Controllers')).toBe(true);
  });

  it('changesInsideBuildOutputs_areDropped', () => {
    expect(forward('src/Api/bin/Debug/net9.0/Api.dll')).toBe(false);
    expect(forward('src/Api/obj/project.assets.json')).toBe(false);
    expect(forward('.vs/Solution/v17/.suo')).toBe(false);
    expect(forward('node_modules/pkg/index.js')).toBe(false);
  });

  it('ignoredDirectoryCasing_doesNotMatter', () => {
    expect(forward('src/Api/Bin/Debug/Api.dll')).toBe(false);
    expect(forward('src/Api/OBJ/project.assets.json')).toBe(false);
  });

  it('theIgnoredDirectoryEntryItself_isForwarded_soItsParentListingStaysLive', () => {
    expect(forward('src/Api/bin')).toBe(true);
    expect(forward('src/Api/obj')).toBe(true);
    expect(forward('node_modules')).toBe(true);
  });

  it('windowsSeparators_areHandled', () => {
    expect(forward('src\\Api\\bin\\Debug\\Api.dll')).toBe(false);
    expect(forward('src\\Api\\Program.cs')).toBe(true);
    expect(forward('.git\\HEAD')).toBe(true);
  });

  it('gitBookkeepingChurn_isDropped', () => {
    expect(forward('.git/objects/ab/cdef0123456789')).toBe(false);
    expect(forward('.git/logs/HEAD')).toBe(false);
    expect(forward('.git/index.lock')).toBe(false);
    expect(forward('.git/FETCH_HEAD.lock')).toBe(false);
  });

  it('gitSignalEntries_areForwarded', () => {
    expect(forward('.git/HEAD')).toBe(true);
    expect(forward('.git/index')).toBe(true);
    expect(forward('.git/packed-refs')).toBe(true);
    expect(forward('.git/MERGE_HEAD')).toBe(true);
    expect(forward('.git/ORIG_HEAD')).toBe(true);
    expect(forward('.git/REBASE_HEAD')).toBe(true);
    expect(forward('.git/refs/heads/main')).toBe(true);
    expect(forward('.git/refs/remotes/origin/main')).toBe(true);
  });

  it('theGitDirectoryEntryItself_isForwarded', () => {
    expect(forward('.git')).toBe(true);
  });

  it('nestedRepositories_useTheirOwnGitFilter', () => {
    expect(forward('vendor/lib/.git/HEAD')).toBe(true);
    expect(forward('vendor/lib/.git/objects/ab/cd')).toBe(false);
  });

  it('ignoredAncestorsWin_overDeeperGitSignals', () => {
    expect(forward('node_modules/pkg/.git/HEAD')).toBe(false);
    expect(forward('bin/repo/.git/refs/heads/main')).toBe(false);
  });

  it('withNoVersionControlPlugin_aMetadataDirectoryIsJustADirectory', () => {
    // Core names no tool's layout: without a plugin declaring `.git`, its churn is ordinary churn.
    expect(shouldForwardTreeEvent('.git/objects/ab/cd')).toBe(true);
  });

  it('aMetadataDirectoryDeclaredWithoutSignals_forwardsEverything', () => {
    const svn: MetadataPolicies = new Map<string, readonly string[]>([['.svn', []]]);
    expect(shouldForwardTreeEvent('.svn/wc.db', svn)).toBe(true);
    expect(shouldForwardTreeEvent('.svn/pristine/ab/abcdef', svn)).toBe(true);
  });
});
