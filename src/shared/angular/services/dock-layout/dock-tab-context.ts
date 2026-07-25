import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

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
   * Holds the path layout presets are keyed on for this dock, or null to key on {@link root}. A
   * worktree checkout's dock keys its preset pick on the CONTAINER path, so every checkout of one
   * container shares a single pick.
   */
  private readonly presetRootSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the owning tab's identifier.
   */
  public readonly tabId: Signal<string> = this.tabIdSignal.asReadonly();

  /**
   * Gets the absolute path the tab is rooted at, or null when none is open.
   */
  public readonly root: Signal<string | null> = this.rootSignal.asReadonly();

  /**
   * Gets the path layout presets are keyed on: the explicitly-set preset root when one was given
   * (a worktree checkout keys on its container), else the tab's own root.
   */
  public readonly presetRoot: Signal<string | null> = computed(
    (): string | null => this.presetRootSignal() ?? this.rootSignal(),
  );

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

  /**
   * Sets the path layout presets are keyed on, overriding the tab root.
   * @param root The preset-keying path, or null to key on the tab root.
   */
  public setPresetRoot(root: string | null): void {
    this.presetRootSignal.set(root);
  }
}
