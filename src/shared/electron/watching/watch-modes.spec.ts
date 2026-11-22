import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { MetadataPolicies } from '../directory-watch-filter';
import { WatchModes } from './watch-modes';

/**
 * Builds modes whose links resolve from a fixed table, so a link can be described without a disk.
 * @param links The real path of each linked path.
 * @param caseInsensitive Whether paths are compared without regard to case.
 * @returns Returns the modes.
 */
function modesWith(
  links: Readonly<Record<string, string>> = {},
  caseInsensitive: boolean = false,
): WatchModes {
  return new WatchModes(
    (): MetadataPolicies => new Map<string, readonly string[]>(),
    caseInsensitive,
    (target: string): Promise<string | undefined> => Promise.resolve(links[target] ?? target),
  );
}

describe('WatchModes', () => {
  it('watchesEverythingNatively_untilAFolderIsPolled', async () => {
    const modes: WatchModes = modesWith();

    expect(modes.hasFolders).toBe(false);
    expect(modes.pollIntervalFor('/Volumes/Share/site')).toBeUndefined();
    expect(await modes.resolvePollInterval('/Volumes/Share/site')).toBeUndefined();
  });

  it('pollsARootInsideAPolledFolder_atTheInterval', async () => {
    const modes: WatchModes = modesWith();

    await modes.update(['/Volumes/Share'], 5);

    expect(modes.pollIntervalFor('/Volumes/Share/site')).toBe(5000);
    expect(modes.pollIntervalFor('/Volumes/Share')).toBe(5000);
    expect(modes.pollIntervalFor('/Users/me/site')).toBeUndefined();
  });

  it('matchesWhateverTheTrailingSlashes', async () => {
    const modes: WatchModes = modesWith();

    await modes.update(['/Volumes/Share/'], 2);

    expect(modes.pollIntervalFor('/Volumes/Share/')).toBe(2000);
    expect(modes.pollIntervalFor('/Volumes/Share/site/')).toBe(2000);
    expect(modes.pollIntervalFor('/Volumes/Shared')).toBeUndefined();
  });

  it('ignoresCase_onlyWhereThePlatformDoes', async () => {
    const insensitive: WatchModes = modesWith({}, true);
    const sensitive: WatchModes = modesWith({}, false);

    await insensitive.update(['/Volumes/Share'], 2);
    await sensitive.update(['/Volumes/Share'], 2);

    expect(insensitive.pollIntervalFor('/volumes/SHARE/site')).toBe(2000);
    expect(sensitive.pollIntervalFor('/volumes/SHARE/site')).toBeUndefined();
  });

  it('pollsARootReachedThroughALink_toAPolledFolder', async () => {
    const modes: WatchModes = modesWith({ '/Users/me/site': '/Volumes/Share/site' });

    await modes.update(['/Volumes/Share'], 2);

    // As written the root is not inside the share; only its real path is.
    expect(modes.pollIntervalFor('/Users/me/site')).toBeUndefined();
    expect(await modes.resolvePollInterval('/Users/me/site')).toBe(2000);
  });

  it('honoursAPolledFolderListedByALink_forTheFolderItNames', async () => {
    const modes: WatchModes = modesWith({ '/Users/me/share': '/Volumes/Share' });

    await modes.update(['/Users/me/share'], 2);

    expect(modes.pollIntervalFor('/Volumes/Share/site')).toBe(2000);
  });

  it('followsRealLinksOnDisk', async () => {
    const scratch: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'watch-modes-')));
    try {
      const share: string = path.join(scratch, 'share');
      mkdirSync(path.join(share, 'site'), { recursive: true });
      symlinkSync(share, path.join(scratch, 'link'));
      const modes: WatchModes = new WatchModes(
        (): MetadataPolicies => new Map<string, readonly string[]>(),
        false,
      );

      await modes.update([share], 2);

      expect(await modes.resolvePollInterval(path.join(scratch, 'link', 'site'))).toBe(2000);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('tellsSubscribers_whenTheFoldersChange_butNotWhenNothingDid', async () => {
    const modes: WatchModes = modesWith();
    let told: number = 0;
    const unsubscribe: () => void = modes.onChange((): void => {
      told += 1;
    });

    await modes.update(['/Volumes/Share'], 2);
    await modes.update(['/Volumes/Share/'], 2);
    await modes.update(['/Volumes/Share'], 10);
    unsubscribe();
    await modes.update([], 10);

    expect(told).toBe(2);
  });

  it('keepsAFolderListedByALinkMatching_whileAnotherIsAdded', async () => {
    const resolving: string[] = [];
    const modes: WatchModes = new WatchModes(
      (): MetadataPolicies => new Map<string, readonly string[]>(),
      false,
      (target: string): Promise<string | undefined> => {
        resolving.push(target);
        return Promise.resolve(target === '/Users/me/share' ? '/Volumes/Share' : target);
      },
    );
    await modes.update(['/Users/me/share'], 2);
    const seen: (number | undefined)[] = [];
    modes.onChange((): void => {
      seen.push(modes.pollIntervalFor('/Volumes/Share/site'));
    });
    resolving.length = 0;

    await modes.update(['/Users/me/share', '/mnt/nfs'], 2);

    // Never flipped to native while the new folder resolved, and only the new one was resolved.
    expect(seen).toEqual([2000]);
    expect(resolving).toEqual(['/mnt/nfs']);
  });

  it('dropsWhatIsNotAnAbsoluteFolder', async () => {
    const modes: WatchModes = modesWith();

    await modes.update(['relative/share', 7], 2);

    expect(modes.hasFolders).toBe(false);
  });
});
