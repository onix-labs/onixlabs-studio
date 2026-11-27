import {
  computed,
  inject,
  InjectionToken,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import {
  AttentionReason,
  OpenOptions,
  Tab,
  TabType,
  TabTypeMetadata,
  TAB_TYPE_METADATA,
} from './tab';

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
 * The identifier of the first Studio window, which every tab belongs to until it is moved (#1587).
 */
export const MAIN_WINDOW_ID: string = 'main';

/**
 * Names the Studio window a shell component belongs to, so the title strip and content area show that
 * window's tabs. Every window provides its own; anything outside a window's shell is in the first.
 */
export const SHELL_WINDOW: InjectionToken<string> = new InjectionToken<string>('SHELL_WINDOW', {
  providedIn: 'root',
  factory: (): string => MAIN_WINDOW_ID,
});

/**
 * Describes one window's slice of the registry.
 */
interface WindowView {
  /**
   * Gets the window's tabs, in strip order.
   */
  readonly tabs: Signal<readonly Tab[]>;

  /**
   * Gets the window's active tab's identifier, or undefined when the window has no tabs.
   */
  readonly activeTabId: Signal<string | undefined>;
}

/**
 * Represents the registry of open top-level tabs, the Studio window each belongs to, and each window's
 * active tab (#1587).
 *
 * Every window shows its own tabs and has its own active tab; the window in front is the focused one,
 * and "the active tab" — what the ribbon, status strip, menu and shortcuts act on — is the focused
 * window's. With one window, which is every window today, that is exactly the tab in front. The full
 * list ({@link tabs}) keeps every window's tabs, for what spans the app: Mission Control, the unsaved
 * work a quit asks about, an agent finding the tab it runs in.
 */
@Service()
export class Tabs {
  /**
   * Holds every open tab, in strip order within each window.
   */
  private readonly tabList: WritableSignal<readonly Tab[]> = signal<readonly Tab[]>([]);

  /**
   * Holds the window each tab belongs to, by tab id; a tab with no entry is in the first window.
   */
  private readonly windowOfTab: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());

  /**
   * Holds each window's active tab, by window id; a window with no entry has none.
   */
  private readonly activeIds: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());

  /**
   * Holds the identifier of the window in front.
   */
  private readonly focusedWindowId: WritableSignal<string> = signal<string>(MAIN_WINDOW_ID);

  /**
   * Holds each window's slice, made once per window.
   */
  private readonly views: Map<string, WindowView> = new Map<string, WindowView>();

  /**
   * Holds the live attention claims per tab, keyed by tab id. Plain state rather than a signal: it is
   * only ever read to decide the tab's own `attention` flag, which is what the UI reads.
   */
  private readonly attentionClaims: Map<string, Set<AttentionReason>> = new Map<
    string,
    Set<AttentionReason>
  >();

  /**
   * Tracks the running counter used to generate unique tab identifiers.
   */
  private sequence: number = 0;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets every open tab, in every window.
   */
  public readonly tabs: Signal<readonly Tab[]> = this.tabList.asReadonly();

  /**
   * Gets the identifier of the window in front.
   */
  public readonly focusedWindow: Signal<string> = this.focusedWindowId.asReadonly();

  /**
   * Gets the identifier of the active tab — the focused window's — or undefined when it has none.
   */
  public readonly activeTabId: Signal<string | undefined> = computed((): string | undefined =>
    this.activeIds().get(this.focusedWindowId()),
  );

  /**
   * Gets the active tab — the focused window's — or undefined when it has none.
   */
  public readonly activeTab: Signal<Tab | undefined> = computed((): Tab | undefined => {
    const id: string | undefined = this.activeTabId();
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
   *
   * Opened in the background, nothing is activated — neither the new tab nor an existing one — unless
   * no tab is active at all, when there is nothing for the user to be looking at instead.
   * @param type The type of tab to open.
   * @param resourceKey The identity of the resource the tab represents, when it is backed by one.
   * @param options How to open it; in the background, the active tab stays active.
   * @returns Returns the opened, or re-activated, tab.
   */
  public open(
    type: TabType,
    resourceKey?: string,
    options?: OpenOptions & { readonly windowId?: string },
  ): Tab {
    if (SINGLETON_TAB_TYPES.has(type)) {
      const existing: Tab | undefined = this.tabList().find(
        (tab: Tab): boolean => tab.type === type,
      );
      if (existing !== undefined) {
        this.log.debug('Tabs', `Activating existing singleton tab '${type}'`, existing.id);
        this.bringForward(existing.id, options);
        return existing;
      }
    } else if (resourceKey !== undefined) {
      const existing: Tab | undefined = this.findByResource(type, resourceKey);
      if (existing !== undefined) {
        this.log.debug('Tabs', `Activating existing tab for resource`, type, resourceKey);
        this.bringForward(existing.id, options);
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
    // A new tab opens in the window it was asked for in, or the one in front.
    const windowId: string = options?.windowId ?? this.focusedWindowId();
    if (windowId !== MAIN_WINDOW_ID) {
      this.windowOfTab.update((windows: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
        new Map<string, string>(windows).set(tab.id, windowId),
      );
    }
    this.bringForward(tab.id, options);
    this.log.info(
      'Tabs',
      `Opened tab '${type}'${options?.background === true ? ' in the background' : ''}`,
      tab.id,
      resourceKey,
    );
    return tab;
  }

  /**
   * Makes a tab that was just opened, or asked for again, the active one in its window, and brings its
   * window to the front — unless it was opened in the background and the user already has a tab in
   * front of them there.
   * @param id The tab's identifier.
   * @param options How it was opened.
   */
  private bringForward(id: string, options: OpenOptions | undefined): void {
    const windowId: string = this.windowOf(id);
    if (options?.background === true) {
      if (this.activeIds().get(windowId) === undefined) {
        this.setActive(windowId, id);
      }
      return;
    }
    this.setActive(windowId, id);
    this.focusedWindowId.set(windowId);
  }

  /**
   * Gets the window a tab belongs to.
   * @param id The tab's identifier.
   * @returns Returns the window's identifier: the first window's for a tab never moved, or not open.
   */
  public windowOf(id: string): string {
    return this.windowOfTab().get(id) ?? MAIN_WINDOW_ID;
  }

  /**
   * Gets one window's tabs, in strip order.
   * @param windowId The window's identifier.
   * @returns Returns the window's tabs.
   */
  public tabsIn(windowId: string): Signal<readonly Tab[]> {
    return this.viewOf(windowId).tabs;
  }

  /**
   * Gets one window's active tab's identifier.
   * @param windowId The window's identifier.
   * @returns Returns the identifier, or undefined when the window has no tabs.
   */
  public activeTabIdIn(windowId: string): Signal<string | undefined> {
    return this.viewOf(windowId).activeTabId;
  }

  /**
   * Gets whether a tab is the one the user is working in: the active tab of the window in front. A
   * view showing in another window is visible, but only this one may claim what the app has one of —
   * the ribbon's commands, the shortcuts, the active document.
   *
   * A tab this registry does not know (a view mounted outside the strip, as in a component's own
   * tests) counts as current, so it behaves exactly as it did before there were several windows.
   * @param tabId Reads the tab's identifier; undefined is never current.
   * @returns Returns the answer, as a signal.
   */
  public isCurrent(tabId: () => string | undefined): Signal<boolean> {
    return computed((): boolean => {
      const id: string | undefined = tabId();
      if (id === undefined) {
        return false;
      }
      return this.get(id) === undefined || this.activeTabId() === id;
    });
  }

  /**
   * Brings a window to the front, so the active tab is its active tab.
   * @param windowId The window's identifier.
   */
  public focusWindow(windowId: string): void {
    if (this.focusedWindowId() !== windowId) {
      this.log.debug('Tabs', 'Focused window', windowId);
      this.focusedWindowId.set(windowId);
    }
  }

  /**
   * Moves a tab into another window, where it becomes the active tab at the end of the strip (a pinned
   * tab keeps its place at the front); the window it left activates its neighbour, as a close would.
   * @param id The tab's identifier.
   * @param windowId The window it moves to.
   */
  public moveToWindow(id: string, windowId: string): void {
    const from: string = this.windowOf(id);
    if (this.get(id) === undefined || from === windowId) {
      return;
    }
    const before: readonly Tab[] = this.tabsIn(from)();
    const tab: Tab = this.get(id)!;
    if (!isPinnedTabType(tab.type)) {
      // Last in the full list is last in every window's slice of it.
      this.tabList.set([...this.tabList().filter((each: Tab): boolean => each.id !== id), tab]);
    }
    this.windowOfTab.update((windows: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
      const next: Map<string, string> = new Map<string, string>(windows);
      if (windowId === MAIN_WINDOW_ID) {
        next.delete(id);
      } else {
        next.set(id, windowId);
      }
      return next;
    });
    if (this.activeIds().get(from) === id) {
      this.setActive(from, this.neighbourOf(before, id));
    }
    this.setActive(windowId, id);
    this.log.info('Tabs', 'Moved tab to window', id, windowId);
  }

  /**
   * Forgets a window that has closed: its slice and its active tab. Its tabs must already have moved
   * or closed. When it was in front, the first window comes to the front.
   * @param windowId The window's identifier.
   */
  public forgetWindow(windowId: string): void {
    if (windowId === MAIN_WINDOW_ID) {
      return;
    }
    this.views.delete(windowId);
    this.setActive(windowId, undefined);
    if (this.focusedWindowId() === windowId) {
      this.focusedWindowId.set(MAIN_WINDOW_ID);
    }
  }

  /**
   * Gets (making it the first time) a window's slice of the registry.
   * @param windowId The window's identifier.
   * @returns Returns the slice.
   */
  private viewOf(windowId: string): WindowView {
    let view: WindowView | undefined = this.views.get(windowId);
    if (view === undefined) {
      view = {
        tabs: computed((): readonly Tab[] => {
          const windows: ReadonlyMap<string, string> = this.windowOfTab();
          return this.tabList().filter(
            (tab: Tab): boolean => (windows.get(tab.id) ?? MAIN_WINDOW_ID) === windowId,
          );
        }),
        activeTabId: computed((): string | undefined => this.activeIds().get(windowId)),
      };
      this.views.set(windowId, view);
    }
    return view;
  }

  /**
   * Sets a window's active tab.
   * @param windowId The window's identifier.
   * @param id The tab's identifier, or undefined for none.
   */
  private setActive(windowId: string, id: string | undefined): void {
    if (this.activeIds().get(windowId) === id) {
      return;
    }
    this.activeIds.update((active: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
      const next: Map<string, string> = new Map<string, string>(active);
      if (id === undefined) {
        next.delete(windowId);
      } else {
        next.set(windowId, id);
      }
      return next;
    });
  }

  /**
   * Gets the tab that takes over when one leaves a window: the following one, or the preceding one
   * when it was last.
   * @param tabs The window's tabs before it left.
   * @param id The leaving tab's identifier.
   * @returns Returns the neighbour's identifier, or undefined when the window is left empty.
   */
  private neighbourOf(tabs: readonly Tab[], id: string): string | undefined {
    const index: number = tabs.findIndex((tab: Tab): boolean => tab.id === id);
    const remaining: readonly Tab[] = tabs.filter((tab: Tab): boolean => tab.id !== id);
    return (remaining[index] ?? remaining[index - 1])?.id;
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
   * Activates the tab with the given identifier in its window, and brings that window to the front.
   * The call is ignored when no such tab exists.
   * @param id The identifier of the tab to activate.
   */
  public activate(id: string): void {
    const exists: boolean = this.tabList().some((tab: Tab): boolean => tab.id === id);
    if (exists) {
      this.log.info('Tabs', 'Activated tab', id);
      const windowId: string = this.windowOf(id);
      this.setActive(windowId, id);
      this.focusedWindowId.set(windowId);
    }
  }

  /**
   * Closes the tab with the given identifier. When the closed tab was its window's active tab, the
   * adjacent tab in that window (the following one, or the preceding one when closing the last tab)
   * becomes active.
   * @param id The identifier of the tab to close.
   */
  public close(id: string): void {
    const current: readonly Tab[] = this.tabList();
    if (!current.some((tab: Tab): boolean => tab.id === id)) {
      return;
    }
    const windowId: string = this.windowOf(id);
    const windowTabs: readonly Tab[] = this.tabsIn(windowId)();

    this.tabList.set(current.filter((tab: Tab): boolean => tab.id !== id));
    if (this.windowOfTab().has(id)) {
      this.windowOfTab.update(
        (windows: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
          const next: Map<string, string> = new Map<string, string>(windows);
          next.delete(id);
          return next;
        },
      );
    }
    // Drop the closed tab's attention claims with it: ids are never reused, but the map would
    // otherwise grow for the life of the window.
    this.attentionClaims.delete(id);
    this.log.info('Tabs', 'Closed tab', id);

    if (this.activeIds().get(windowId) === id) {
      const neighbour: string | undefined = this.neighbourOf(windowTabs, id);
      this.log.debug('Tabs', 'Active tab closed; activating neighbour', neighbour);
      this.setActive(windowId, neighbour);
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
   * Sets one reason's claim on the attention state of the tab with the given identifier (the dot
   * drawing the user to a tab that needs them). A tab wants attention while **any** reason claims it.
   *
   * The claim is per reason rather than a bare boolean because the sources are independent and each
   * one sweeps every tab it owns on every evaluation: the agent bridge marks the tabs with a pending
   * ask and clears the rest, the conflict watcher does the same for tabs whose file changed on disk.
   * Against a single flag those two sweeps overwrite each other — whichever effect ran last won — so a
   * document tab with a waiting agent would light and then go dark again the next time anything moved.
   * Keeping the claims apart and OR-ing them lets both sources sweep freely and say what they mean.
   *
   * Idempotent — a no-op when the resulting state is unchanged — so it is safe to call from an effect.
   * Unknown identifiers are ignored.
   * @param id The identifier of the tab to update.
   * @param reason What is asking for the user, so it can be cleared without disturbing the others.
   * @param attention Whether that reason currently needs the user's attention.
   */
  public setAttention(id: string, reason: AttentionReason, attention: boolean): void {
    const current: Tab | undefined = this.tabList().find((tab: Tab): boolean => tab.id === id);
    if (current === undefined) {
      return;
    }
    const claims: Set<AttentionReason> = this.attentionClaims.get(id) ?? new Set<AttentionReason>();
    if (claims.has(reason) === attention) {
      return;
    }
    if (attention) {
      claims.add(reason);
    } else {
      claims.delete(reason);
    }
    this.attentionClaims.set(id, claims);

    const wanted: boolean = claims.size > 0;
    if ((current.attention ?? false) === wanted) {
      return;
    }
    this.tabList.update((tabs: readonly Tab[]): readonly Tab[] =>
      tabs.map((tab: Tab): Tab => (tab.id === id ? { ...tab, attention: wanted } : tab)),
    );
  }

  /**
   * Moves a tab from one position to another within a window's strip. Out-of-range or no-op indices
   * are ignored.
   * @param fromIndex The current index of the tab to move, in the window's strip.
   * @param toIndex The index the tab should occupy after the move, in the window's strip.
   * @param windowId The window whose strip it is; the one in front when omitted.
   */
  public reorder(fromIndex: number, toIndex: number, windowId?: string): void {
    const window: string = windowId ?? this.focusedWindowId();
    const current: readonly Tab[] = this.tabsIn(window)();
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
    // The window's tabs take the places its tabs held in the full list, in their new order; every
    // other window's keep theirs.
    const reordered: Tab[] = [...next];
    const ids: ReadonlySet<string> = new Set<string>(current.map((tab: Tab): string => tab.id));
    this.tabList.set(
      this.tabList().map((tab: Tab): Tab => (ids.has(tab.id) ? reordered.shift()! : tab)),
    );
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
