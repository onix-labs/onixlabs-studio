import { TestBed } from '@angular/core/testing';

import { RecentItem, RecentItems } from './recent-items';

const KEY: string = 'welcome.recentItems';

describe('RecentItems', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * Resolves the root-provided registry.
   */
  function service(): RecentItems {
    return TestBed.inject(RecentItems);
  }

  it('record_addsItemsMostRecentFirst', () => {
    const recent: RecentItems = service();

    recent.record('/a', 'a', 'code');
    recent.record('/b', 'b', 'directory');

    expect(recent.items().map((item) => item.path)).toEqual(['/b', '/a']);
  });

  it('record_whenPathAlreadyPresent_dedupesAndMovesToFront', () => {
    const recent: RecentItems = service();

    recent.record('/a', 'a', 'code');
    recent.record('/b', 'b', 'code');
    recent.record('/a', 'a', 'code');

    expect(recent.items().map((item) => item.path)).toEqual(['/a', '/b']);
  });

  it('record_whenReRecordingAPinnedItem_keepsItPinned', () => {
    const recent: RecentItems = service();

    recent.record('/a', 'a', 'code');
    recent.togglePin('/a');
    recent.record('/a', 'a', 'code');

    expect(recent.items()[0].pinned).toBe(true);
  });

  it('record_withEmptyPath_isIgnored', () => {
    const recent: RecentItems = service();

    recent.record('', 'x', 'code');

    expect(recent.items()).toEqual([]);
  });

  it('remove_dropsTheItem', () => {
    const recent: RecentItems = service();
    recent.record('/a', 'a', 'code');
    recent.record('/b', 'b', 'code');

    recent.remove('/a');

    expect(recent.items().map((item) => item.path)).toEqual(['/b']);
  });

  it('togglePin_flipsThePinnedState', () => {
    const recent: RecentItems = service();
    recent.record('/a', 'a', 'code');

    recent.togglePin('/a');
    expect(recent.items()[0].pinned).toBe(true);

    recent.togglePin('/a');
    expect(recent.items()[0].pinned).toBe(false);
  });

  it('clear_emptiesTheList', () => {
    const recent: RecentItems = service();
    recent.record('/a', 'a', 'code');

    recent.clear();

    expect(recent.items()).toEqual([]);
  });

  it('record_boundsUnpinnedEntriesButKeepsPinnedOnes', () => {
    const recent: RecentItems = service();
    recent.record('/keep', 'keep', 'code');
    recent.togglePin('/keep');

    for (let index: number = 0; index < 35; index += 1) {
      recent.record(`/f${index}`, `f${index}`, 'code');
    }

    const items: readonly RecentItem[] = recent.items();
    expect(items.some((item) => item.path === '/keep' && item.pinned)).toBe(true);
    expect(items.filter((item) => !item.pinned).length).toBe(30);
    expect(items.some((item) => item.path === '/f0')).toBe(false);
    expect(items.some((item) => item.path === '/f34')).toBe(true);
  });

  it('persistence_survivesAcrossInstances', () => {
    service().record('/a', 'a', 'markdown');

    TestBed.resetTestingModule();
    const restored: RecentItems = TestBed.inject(RecentItems);

    expect(restored.items().map((item) => item.path)).toEqual(['/a']);
    expect(restored.items()[0].kind).toBe('markdown');
  });

  it('restore_dropsMalformedEntries', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { path: '/good', name: 'good', kind: 'code', openedAt: 1, pinned: true },
        { path: '', name: 'empty', kind: 'code', openedAt: 1 },
        { path: '/bad-kind', name: 'x', kind: 'nope', openedAt: 1 },
        { path: '/no-time', name: 'y', kind: 'code' },
        'garbage',
        null,
      ]),
    );

    const recent: RecentItems = service();

    expect(recent.items().map((item) => item.path)).toEqual(['/good']);
    expect(recent.items()[0].pinned).toBe(true);
  });

  it('restore_whenStorageIsGarbage_startsEmpty', () => {
    localStorage.setItem(KEY, '{"not":"an array"}');

    expect(service().items()).toEqual([]);
  });

  it('restore_keepsEveryDeclaredKind', () => {
    // The validation set previously missed 'binary', silently dropping persisted binary recents on
    // every restart; every kind the type declares must round-trip through storage.
    const kinds: readonly string[] = ['directory', 'repository', 'markdown', 'code', 'binary'];
    localStorage.setItem(
      KEY,
      JSON.stringify(
        kinds.map((kind: string, index: number) => ({
          path: `/${kind}`,
          name: kind,
          kind,
          openedAt: index,
        })),
      ),
    );

    expect(
      service()
        .items()
        .map((item) => item.kind),
    ).toEqual(kinds);
  });
});
