import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Tab, TabType, TabTypeMetadata, TAB_TYPE_METADATA } from './tab';

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
   * Opens a new tab of the given type and activates it. The settings tab is a singleton: opening
   * it while one already exists activates the existing tab instead of creating another.
   * @param type The type of tab to open.
   * @returns Returns the opened, or re-activated, tab.
   */
  public open(type: TabType): Tab {
    if (type === 'settings') {
      const existing: Tab | undefined = this.tabList().find(
        (tab: Tab): boolean => tab.type === 'settings',
      );
      if (existing !== undefined) {
        this.activeId.set(existing.id);
        return existing;
      }
    }

    const tab: Tab = this.createTab(type);
    const current: readonly Tab[] = this.tabList();

    // The settings tab is pinned to the front; every other tab opens at the end.
    this.tabList.set(type === 'settings' ? [tab, ...current] : [...current, tab]);
    this.activeId.set(tab.id);
    return tab;
  }

  /**
   * Activates the tab with the given identifier. The call is ignored when no such tab exists.
   * @param id The identifier of the tab to activate.
   */
  public activate(id: string): void {
    const exists: boolean = this.tabList().some((tab: Tab): boolean => tab.id === id);
    if (exists) {
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

    if (this.activeId() === id) {
      const neighbour: Tab | undefined = remaining[index] ?? remaining[index - 1];
      this.activeId.set(neighbour?.id);
    }
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

    const next: Tab[] = [...current];
    const moved: Tab = next.splice(fromIndex, 1)[0];
    next.splice(toIndex, 0, moved);
    this.tabList.set(next);
  }

  /**
   * Creates a new tab of the given type with a unique identifier and default presentation.
   * @param type The type of tab to create.
   * @returns Returns the newly created tab.
   */
  private createTab(type: TabType): Tab {
    this.sequence += 1;
    const metadata: TabTypeMetadata = TAB_TYPE_METADATA[type];
    return { id: `tab-${this.sequence}`, type, title: metadata.label, icon: metadata.icon };
  }
}
