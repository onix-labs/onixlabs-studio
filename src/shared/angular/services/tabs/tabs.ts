import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Tab, TabType, TabTypeMetadata, TAB_TYPE_METADATA } from './tab';

/**
 * Specifies the tab types that are singletons: opening one when an instance is already open activates
 * the existing tab rather than creating a duplicate. These tabs are not backed by a resource, so the
 * resource-key dedup does not apply to them.
 */
const SINGLETON_TAB_TYPES: ReadonlySet<TabType> = new Set<TabType>([
  'settings',
  'mission-control',
  'containers',
  // Machine-wide tools: a second copy would show the same thing and duplicate its polling.
  'model-manager',
  'plugin-manager',
]);

/**
 * Specifies the tab types pinned to the front of the strip, in their fixed left-to-right order. A
 * pinned tab is immovable and always sits ahead of every ordinary tab, and never lands out of this
 * order: Settings is leftmost, Mission Control next. Ordinary tabs follow, in the order opened.
 */
const PINNED_TAB_ORDER: readonly TabType[] = ['settings', 'mission-control'];

/**
 * Returns whether a tab type is pinned to the front of the strip, and so is immovable (it cannot be
 * dragged or reordered). Shared with the tab chrome so a pinned tab disables its own drag.
 * @param type The tab type to test.
 * @returns Returns true when the type is pinned.
 */
export function isPinnedTabType(type: TabType): boolean {
  return PINNED_TAB_ORDER.includes(type);
}

/**
 * Represents the registry of open top-level tabs and the currently active selection.
 */
@Service()
export class Tabs {
  /**
   * Holds the ordered list of open tabs.
   */
  private readonly tabList: WritableSignal<readonly Tab[]> = signal<readonly Tab[]>([]);

  /**
   * Holds the identifier of the active tab, or undefined when no tab is open.
   */
  private readonly activeId: WritableSignal<string | undefined> = signal<string | undefined>(
    undefined,
  );

  /**
   * Tracks the running counter used to generate unique tab identifiers.
   */
  private sequence: number = 0;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the ordered list of open tabs.
   */
  public readonly tabs: Signal<readonly Tab[]> = this.tabList.asReadonly();

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  public readonly activeTabId: Signal<string | undefined> = this.activeId.asReadonly();

  /**
   * Gets the active tab, or undefined when no tab is open.
   */
  public readonly activeTab: Signal<Tab | undefined> = computed((): Tab | undefined => {
    const id: string | undefined = this.activeId();
    return this.tabList().find((tab: Tab): boolean => tab.id === id);
  });

  /**
   * Gets a value indicating whether a settings tab is currently open.
   */
  public readonly isSettingsOpen: Signal<boolean> = computed((): boolean =>
    this.tabList().some((tab: Tab): boolean => tab.type === 'settings'),
  );

  /**
   * Opens a new tab of the given type and activates it. A tab may be tied to a resource (a directory,
   * repository, or file): opening a resource that already has a tab of the same type activates the
   * existing tab instead of creating a duplicate. The settings tab is a singleton on the same basis.
   * @param type The type of tab to open.
   * @param resourceKey The identity of the resource the tab represents, when it is backed by one.
   * @returns Returns the opened, or re-activated, tab.
   */
  public open(type: TabType, resourceKey?: string): Tab {
    if (SINGLETON_TAB_TYPES.has(type)) {
      const existing: Tab | undefined = this.tabList().find(
        (tab: Tab): boolean => tab.type === type,
      );
      if (existing !== undefined) {
        this.log.debug('Tabs', `Activating existing singleton tab '${type}'`, existing.id);
        this.activeId.set(existing.id);
        return existing;
      }
    } else if (resourceKey !== undefined) {
      const existing: Tab | undefined = this.findByResource(type, resourceKey);
      if (existing !== undefined) {
        this.log.debug('Tabs', `Activating existing tab for resource`, type, resourceKey);
        this.activeId.set(existing.id);
        return existing;
      }
    }

    const tab: Tab = this.createTab(type, resourceKey);
    const current: readonly Tab[] = this.tabList();

    // Pinned tabs (Settings, then Mission Control) hold a fixed front prefix; a new tab slots in after
    // every existing tab of the same or higher pin priority, so ordinary tabs open at the end and each
    // pinned tab lands in its reserved place.
    const rank: number = this.pinRank(type);
    const index: number = current.filter(
      (existing: Tab): boolean => this.pinRank(existing.type) <= rank,
    ).length;
    this.tabList.set([...current.slice(0, index), tab, ...current.slice(index)]);
    this.activeId.set(tab.id);
    this.log.info('Tabs', `Opened tab '${type}'`, tab.id, resourceKey);
    return tab;
  }

  /**
   * Gets the pin priority of a tab type: its index in {@link PINNED_TAB_ORDER} for a pinned type, or a
   * rank past the end for an ordinary type (which sorts after every pinned tab).
   * @param type The tab type.
   * @returns Returns the pin rank.
   */
  private pinRank(type: TabType): number {
    const index: number = PINNED_TAB_ORDER.indexOf(type);
    return index === -1 ? PINNED_TAB_ORDER.length : index;
  }

  /**
   * Gets the open tab with the given identifier, or undefined when no such tab exists.
   * @param id The identifier of the tab to get.
   * @returns Returns the matching tab, or undefined when none is open.
   */
  public get(id: string): Tab | undefined {
    return this.tabList().find((tab: Tab): boolean => tab.id === id);
  }

  /**
   * Finds the open tab of a given type that represents a resource, if any. Used by the open flows to
   * keep a resource single-instance per tab type.
   * @param type The tab type to match.
   * @param resourceKey The resource identity to match.
   * @returns Returns the matching tab, or undefined when none is open.
   */
  public findByResource(type: TabType, resourceKey: string): Tab | undefined {
    return this.tabList().find(
      (tab: Tab): boolean => tab.type === type && tab.resourceKey === resourceKey,
    );
  }

  /**
   * Activates the tab with the given identifier. The call is ignored when no such tab exists.
   * @param id The identifier of the tab to activate.
   */
  public activate(id: string): void {
    const exists: boolean = this.tabList().some((tab: Tab): boolean => tab.id === id);
    if (exists) {
      this.log.info('Tabs', 'Activated tab', id);
      this.activeId.set(id);
    }
  }

  /**
   * Closes the tab with the given identifier. When the closed tab was active, the adjacent tab
   * (the following one, or the preceding one when closing the last tab) becomes active.
   * @param id The identifier of the tab to close.
   */
  public close(id: string): void {
    const current: readonly Tab[] = this.tabList();
    const index: number = current.findIndex((tab: Tab): boolean => tab.id === id);
    if (index === -1) {
      return;
    }

    const remaining: readonly Tab[] = current.filter((tab: Tab): boolean => tab.id !== id);
    this.tabList.set(remaining);
    this.log.info('Tabs', 'Closed tab', id);

    if (this.activeId() === id) {
      const neighbour: Tab | undefined = remaining[index] ?? remaining[index - 1];
      this.log.debug('Tabs', 'Active tab closed; activating neighbour', neighbour?.id);
      this.activeId.set(neighbour?.id);
    }
  }

  /**
   * Renames the tab with the given identifier. Blank titles and unknown identifiers are ignored, so
   * a tab never loses its label to an empty terminal title.
   * @param id The identifier of the tab to rename.
   * @param title The new title.
   */
  public rename(id: string, title: string): void {
    const trimmed: string = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.tabList.update((tabs: readonly Tab[]): readonly Tab[] =>
      tabs.map((tab: Tab): Tab => (tab.id === id ? { ...tab, title: trimmed } : tab)),
    );
  }

  /**
   * Sets the unsaved-changes (dirty) state of the tab with the given identifier. Unknown identifiers
   * are ignored.
   * @param id The identifier of the tab to update.
   * @param dirty Whether the tab has unsaved changes.
   */
  public setDirty(id: string, dirty: boolean): void {
    this.tabList.update((tabs: readonly Tab[]): readonly Tab[] =>
      tabs.map((tab: Tab): Tab => (tab.id === id ? { ...tab, dirty } : tab)),
    );
  }

  /**
   * Sets the attention state of the tab with the given identifier (an accent dot drawing the user to
   * a tab that needs them). Idempotent — a no-op when the state is unchanged — so it is safe to call
   * from an effect. Unknown identifiers are ignored.
   * @param id The identifier of the tab to update.
   * @param attention Whether the tab needs the user's attention.
   */
  public setAttention(id: string, attention: boolean): void {
    const current: Tab | undefined = this.tabList().find((tab: Tab): boolean => tab.id === id);
    if (current === undefined || (current.attention ?? false) === attention) {
      return;
    }
    this.tabList.update((tabs: readonly Tab[]): readonly Tab[] =>
      tabs.map((tab: Tab): Tab => (tab.id === id ? { ...tab, attention } : tab)),
    );
  }

  /**
   * Moves a tab from one position to another within the tab list. Out-of-range or no-op indices
   * are ignored.
   * @param fromIndex The current index of the tab to move.
   * @param toIndex The index the tab should occupy after the move.
   */
  public reorder(fromIndex: number, toIndex: number): void {
    const current: readonly Tab[] = this.tabList();
    const lastIndex: number = current.length - 1;
    const outOfRange: boolean =
      fromIndex < 0 || fromIndex > lastIndex || toIndex < 0 || toIndex > lastIndex;
    if (outOfRange || fromIndex === toIndex) {
      return;
    }

    // The pinned tabs (Settings, then Mission Control) hold an immovable front prefix: none of them can
    // be moved, and no ordinary tab may land ahead of them, so a move out of or into the prefix is
    // rejected or clamped to the first ordinary slot.
    const pinnedCount: number = current.filter(
      (tab: Tab): boolean => this.pinRank(tab.type) < PINNED_TAB_ORDER.length,
    ).length;
    if (fromIndex < pinnedCount) {
      return;
    }
    const targetIndex: number = Math.max(toIndex, pinnedCount);
    if (fromIndex === targetIndex) {
      return;
    }

    const next: Tab[] = [...current];
    const moved: Tab = next.splice(fromIndex, 1)[0];
    next.splice(targetIndex, 0, moved);
    this.tabList.set(next);
  }

  /**
   * Creates a new tab of the given type with a unique identifier and default presentation.
   * @param type The type of tab to create.
   * @param resourceKey The identity of the resource the tab represents, when it is backed by one.
   * @returns Returns the newly created tab.
   */
  private createTab(type: TabType, resourceKey?: string): Tab {
    this.sequence += 1;
    const metadata: TabTypeMetadata = TAB_TYPE_METADATA[type];
    return {
      id: `tab-${this.sequence}`,
      type,
      title: metadata.label,
      icon: metadata.icon,
      iconRotation: metadata.iconRotation,
      resourceKey,
    };
  }
}
