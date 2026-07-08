import { Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Carries the identity of the tab hosting a dock instance to the panels projected inside it. Dock
 * panels are resolved generically and only receive their {@link import('./dock-panel').DockPanel}
 * descriptor, so a panel that needs to know which tab owns it (for a globally-unique session id) and
 * which folder the tab is rooted at (for a working directory) reads them from here instead.
 *
 * Scoped per dock host: each tab that hosts a dock (the directory view and the source-control view)
 * provides its own instance and sets the tab id once on init and the root reactively.
 */
@Service()
export class DockTabContext {
  /**
   * Holds the owning tab's identifier.
   */
  private readonly tabIdSignal: WritableSignal<string> = signal<string>('');

  /**
   * Holds the absolute path the tab is rooted at (its workspace folder or repository root), or null
   * when none is open.
   */
  private readonly rootSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the owning tab's identifier.
   */
  public readonly tabId: Signal<string> = this.tabIdSignal.asReadonly();

  /**
   * Gets the absolute path the tab is rooted at, or null when none is open.
   */
  public readonly root: Signal<string | null> = this.rootSignal.asReadonly();

  /**
   * Sets the owning tab's identifier.
   * @param id The tab identifier.
   */
  public setTabId(id: string): void {
    this.tabIdSignal.set(id);
  }

  /**
   * Sets the absolute path the tab is rooted at.
   * @param root The root path, or null when none is open.
   */
  public setRoot(root: string | null): void {
    this.rootSignal.set(root);
  }
}
