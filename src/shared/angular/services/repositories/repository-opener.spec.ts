import { TestBed } from '@angular/core/testing';

import { RepositoryInfo, SourceControlClient } from '@shared/api/source-control-channels';
import { RecentItem, RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Repositories } from './repositories';
import { RepositoryOpener } from './repository-opener';

/**
 * The repository the stub client resolves.
 */
const INFO: RepositoryInfo = { root: '/repos/studio', name: 'studio' };

describe('RepositoryOpener', () => {
  let opener: RepositoryOpener;
  let tabs: Tabs;
  let repositories: Repositories;
  let nextRepository: RepositoryInfo | null;
  let resolvedDirectories: string[];

  /**
   * Configures the testing module with a stub source-control client whose dialog and folder
   * resolution answer with {@link nextRepository}.
   */
  function setup(): void {
    const client: Pick<SourceControlClient, 'openRepository' | 'resolveRepository'> = {
      openRepository: (): Promise<RepositoryInfo | null> => Promise.resolve(nextRepository),
      resolveRepository: (directory: string): Promise<RepositoryInfo | null> => {
        resolvedDirectories.push(directory);
        return Promise.resolve(nextRepository);
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: SourceControl, useValue: { client } }],
    });
    opener = TestBed.inject(RepositoryOpener);
    tabs = TestBed.inject(Tabs);
    repositories = TestBed.inject(Repositories);
  }

  beforeEach(() => {
    localStorage.clear();
    nextRepository = null;
    resolvedDirectories = [];
  });

  it('openInteractive_whenCancelled_opensNothing', async () => {
    setup();

    expect(await opener.openInteractive()).toBe(false);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('openInteractive_whenARepositoryIsChosen_opensANamedSourceControlTab', async () => {
    setup();
    nextRepository = INFO;

    expect(await opener.openInteractive()).toBe(true);

    const tab: Tab | undefined = tabs.activeTab();
    expect(tab?.type).toBe('source-control');
    expect(tab?.title).toBe('studio');
    expect(tab === undefined ? undefined : repositories.takeInitial(tab.id)).toEqual(INFO);
  });

  it('openInteractive_whenARepositoryIsChosen_recordsARecentItem', async () => {
    setup();
    nextRepository = INFO;

    await opener.openInteractive();

    const recents: readonly RecentItem[] = TestBed.inject(RecentItems).items();
    expect(recents).toHaveLength(1);
    expect(recents[0].path).toBe('/repos/studio');
    expect(recents[0].kind).toBe('repository');
  });

  it('openInteractive_whenTheSameRepositoryIsChosenAgain_focusesTheExistingTab', async () => {
    setup();
    nextRepository = INFO;
    await opener.openInteractive();
    const firstId: string = tabs.tabs()[0].id;

    await opener.openInteractive();

    expect(tabs.tabs()).toHaveLength(1);
    expect(tabs.activeTabId()).toBe(firstId);
  });

  it('openFolder_whenTheFolderIsARepository_resolvesAndOpensIt', async () => {
    setup();
    nextRepository = INFO;

    expect(await opener.openFolder('/repos/studio/src')).toBe(true);

    expect(resolvedDirectories).toEqual(['/repos/studio/src']);
    expect(tabs.activeTab()?.type).toBe('source-control');
  });

  it('openFolder_whenTheFolderIsNotARepository_opensNothing', async () => {
    setup();
    nextRepository = null;

    expect(await opener.openFolder('/tmp/plain')).toBe(false);
    expect(tabs.tabs()).toHaveLength(0);
  });

  it('openInteractive_whenRunningOutsideElectron_reportsFalse', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SourceControl, useValue: { client: undefined } }],
    });
    opener = TestBed.inject(RepositoryOpener);

    expect(await opener.openInteractive()).toBe(false);
  });
});
