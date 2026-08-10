import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * Names the kinds of thing that can appear in the recent-items list. Each maps to how the item is
 * re-opened and which icon and filter it belongs to.
 */
export type RecentKind = 'directory' | 'markdown' | 'code' | 'binary';

/**
 * Maps every {@link RecentKind} to a marker, so the compiler proves the runtime validation set below
 * is exhaustive — adding a kind to the type without listing it here is a compile error. (The set
 * previously missed `binary`, silently dropping persisted binary recents on every restart.)
 */
const ALL_RECENT_KINDS: Readonly<Record<RecentKind, true>> = {
  directory: true,
  markdown: true,
  code: true,
  binary: true,
};

/**
 * Holds the recognised recent-item kinds, used to reject malformed persisted entries on load.
 */
const RECENT_KINDS: ReadonlySet<string> = new Set<string>(Object.keys(ALL_RECENT_KINDS));

/**
 * Maps the kinds that no longer exist onto the ones that replaced them, so entries written by an
 * older Studio survive the change rather than being dropped as unrecognised. Repositories were
 * retired with the unified workspace: a directory is a directory, whether or not Git knows about it.
 */
const RETIRED_RECENT_KINDS: Readonly<Record<string, RecentKind>> = { repository: 'directory' };

/**
 * The storage key the recent-items list is persisted under.
 */
const RECENT_ITEMS_KEY: string = 'welcome.recentItems';

/**
 * The most unpinned entries kept; older unpinned entries are dropped so the list stays bounded.
 * Pinned entries are always kept and do not count towards this cap.
 */
const MAX_UNPINNED: number = 30;

/**
 * Describes an entry shown in the welcome screen's recent-items list.
 *
 * The shape is deliberately serialisable: the display icon, path detail, and relative-time label are
 * all derived from {@link kind}, {@link path}, and {@link openedAt} when the list is rendered, so the
 * record round-trips through storage without carrying any runtime objects.
 */
export interface RecentItem {
  /**
   * Gets the absolute file-system path of the item; also its stable identity for de-duplication.
   */
  readonly path: string;

  /**
   * Gets the display name of the item (typically a file or directory basename).
   */
  readonly name: string;

  /**
   * Gets the kind of the item, which drives how it re-opens, its icon, and its filter.
   */
  readonly kind: RecentKind;

  /**
   * Gets the epoch-millisecond timestamp at which the item was last opened.
   */
  readonly openedAt: number;

  /**
   * Gets a value indicating whether the user has pinned the item to keep it in the list.
   */
  readonly pinned: boolean;
}

/**
 * Represents the registry of recently opened items surfaced on the welcome screen.
 *
 * It records every file, folder, and repository the open flows route, de-duplicated by path and kept
 * most-recent-first. The list is persisted through {@link SettingsStore} and restored on construction,
 * so recents survive a restart; pinned entries are kept indefinitely while unpinned ones are bounded.
 */
@Service()
export class RecentItems {
  /**
   * Holds the persistence backend.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the backing state for {@link items}, seeded from persisted storage.
   */
  private readonly itemsState: WritableSignal<readonly RecentItem[]> = signal<
    readonly RecentItem[]
  >(restoreRecentItems(this.store.get<unknown>(RECENT_ITEMS_KEY, null)));

  /**
   * Gets the recent items, most recent first.
   */
  public readonly items: Signal<readonly RecentItem[]> = this.itemsState.asReadonly();

  /**
   * Records an opened item as the most recently used, de-duplicating by path and preserving whether an
   * existing entry for the same path was pinned.
   * @param path The absolute path of the item.
   * @param name The display name of the item.
   * @param kind The kind of the item.
   */
  public record(path: string, name: string, kind: RecentKind): void {
    if (path.length === 0) {
      return;
    }
    const current: readonly RecentItem[] = this.itemsState();
    const existing: RecentItem | undefined = current.find(
      (item: RecentItem): boolean => item.path === path,
    );
    const entry: RecentItem = {
      path,
      name,
      kind,
      openedAt: Date.now(),
      pinned: existing?.pinned ?? false,
    };
    const rest: readonly RecentItem[] = current.filter(
      (item: RecentItem): boolean => item.path !== path,
    );
    this.commit(trim([entry, ...rest]));
    this.log.info('RecentItems', `Recorded recent ${kind} '${name}'`, path);
  }

  /**
   * Removes the recent item with the given path, if present.
   * @param path The path of the item to remove.
   */
  public remove(path: string): void {
    this.commit(this.itemsState().filter((item: RecentItem): boolean => item.path !== path));
    this.log.debug('RecentItems', 'Removed recent item', path);
  }

  /**
   * Toggles whether the recent item with the given path is pinned.
   * @param path The path of the item to pin or unpin.
   */
  public togglePin(path: string): void {
    this.commit(
      this.itemsState().map(
        (item: RecentItem): RecentItem =>
          item.path === path ? { ...item, pinned: !item.pinned } : item,
      ),
    );
  }

  /**
   * Clears all recent items.
   */
  public clear(): void {
    this.commit([]);
    this.log.info('RecentItems', 'Cleared all recent items');
  }

  /**
   * Sets the list as the new state and persists it.
   * @param next The new list to store.
   */
  private commit(next: readonly RecentItem[]): void {
    this.itemsState.set(next);
    this.store.set<readonly RecentItem[]>(RECENT_ITEMS_KEY, next);
  }
}

/**
 * Bounds a most-recent-first list by keeping every pinned entry and at most {@link MAX_UNPINNED} of
 * the most recent unpinned entries.
 * @param items The list to bound, ordered most-recent-first.
 * @returns Returns the bounded list in the same order.
 */
function trim(items: readonly RecentItem[]): readonly RecentItem[] {
  let unpinned: number = 0;
  return items.filter((item: RecentItem): boolean => {
    if (item.pinned) {
      return true;
    }
    unpinned += 1;
    return unpinned <= MAX_UNPINNED;
  });
}

/**
 * Reconstructs the recent-items list from an untrusted persisted value, dropping any entry that does
 * not match the expected shape rather than throwing.
 * @param raw The value read from storage.
 * @returns Returns the validated list, or an empty list when nothing usable is present.
 */
function restoreRecentItems(raw: unknown): readonly RecentItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: RecentItem[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const record: Record<string, unknown> = entry as Record<string, unknown>;
    if (typeof record['path'] !== 'string' || record['path'].length === 0) {
      continue;
    }
    if (typeof record['name'] !== 'string') {
      continue;
    }
    if (typeof record['kind'] !== 'string') {
      continue;
    }
    const kind: RecentKind | undefined = RECENT_KINDS.has(record['kind'])
      ? (record['kind'] as RecentKind)
      : RETIRED_RECENT_KINDS[record['kind']];
    if (kind === undefined) {
      continue;
    }
    if (typeof record['openedAt'] !== 'number') {
      continue;
    }
    result.push({
      path: record['path'],
      name: record['name'],
      kind,
      openedAt: record['openedAt'],
      pinned: record['pinned'] === true,
    });
  }
  return result;
}
