import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Tracks the workspace root of each top-level tab and projects the active tab's root, so global
 * surfaces (such as the status strip's language-server menu) can scope themselves to the workspace
 * the user is currently looking at. Each per-tab view publishes its root here: a directory tab its
 * open folder, a standalone code tab its file's session root. It is the one global seam that resolves
 * the active tab back to a workspace root without reaching into the tab's scoped services.
 */
@Service()
export class ActiveWorkspace {
  /**
   * Holds the tab registry used to resolve which tab is active.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds each top-level tab's workspace root, keyed by tab id; a null value means the tab has no
   * workspace root (for example a directory tab with no folder open yet).
   */
  private readonly roots: WritableSignal<ReadonlyMap<string, string | null>> = signal<
    ReadonlyMap<string, string | null>
  >(new Map<string, string | null>());

  /**
   * Gets the active tab's workspace root, or null when the active tab has none.
   */
  public readonly rootPath: Signal<string | null> = computed((): string | null => {
    const activeTabId: string | undefined = this.tabs.activeTabId();
    return activeTabId === undefined ? null : (this.roots().get(activeTabId) ?? null);
  });

  /**
   * Publishes a tab's workspace root, replacing any previously published value.
   * @param tabId The owning tab's id.
   * @param rootPath The tab's workspace root, or null when it has none.
   */
  public setRoot(tabId: string, rootPath: string | null): void {
    if (this.roots().get(tabId) === rootPath) {
      return;
    }
    const next: Map<string, string | null> = new Map<string, string | null>(this.roots());
    next.set(tabId, rootPath);
    this.roots.set(next);
  }

  /**
   * Drops a tab's published root when the tab closes.
   * @param tabId The owning tab's id.
   */
  public clearRoot(tabId: string): void {
    if (!this.roots().has(tabId)) {
      return;
    }
    const next: Map<string, string | null> = new Map<string, string | null>(this.roots());
    next.delete(tabId);
    this.roots.set(next);
  }
}
