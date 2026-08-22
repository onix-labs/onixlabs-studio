import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * A workspace tab's document well, published so a global consumer can open a file into it without
 * depending on that tab's injector — the opener itself is workspace-scoped and unreachable from the
 * root.
 */
export interface WorkspaceWell {
  /**
   * Gets the id of the tab whose well this is, so a caller can bring it to the front.
   */
  readonly tabId: string;

  /**
   * Gets the workspace's root directory, or null when the tab has no folder open yet.
   */
  readonly root: string | null;

  /**
   * Opens a file into the well, reusing its panel when the file is already open.
   * @param path The absolute path of the file to open.
   * @returns Returns true when the file was opened.
   */
  open(path: string): Promise<boolean>;
}

/**
 * Tracks the workspace root of each top-level tab and projects the active tab's root, so global
 * surfaces (such as the status strip's language-server menu) can scope themselves to the workspace
 * the user is currently looking at. Each per-tab view publishes its root here: a directory tab its
 * open folder, a standalone code tab its file's session root. It is the one global seam that resolves
 * the active tab back to a workspace root without reaching into the tab's scoped services.
 *
 * A workspace tab also publishes its {@link WorkspaceWell}, which extends the same seam from "what
 * root is the user looking at" to "which workspace can be opened into". The well cannot be reached
 * any other way: `FileOpener` is provided per workspace tab, so nothing at the root can inject it.
 */
@Service()
export class ActiveWorkspace {
  /**
   * Holds the tab registry used to resolve which tab is active.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds each top-level tab's workspace root, keyed by tab id; a null value means the tab has no
   * workspace root (for example a directory tab with no folder open yet).
   */
  private readonly roots: WritableSignal<ReadonlyMap<string, string | null>> = signal<
    ReadonlyMap<string, string | null>
  >(new Map<string, string | null>());

  /**
   * Holds each workspace tab's document-well opener, keyed by tab id.
   */
  private readonly wells: WritableSignal<ReadonlyMap<string, (path: string) => Promise<boolean>>> =
    signal<ReadonlyMap<string, (path: string) => Promise<boolean>>>(
      new Map<string, (path: string) => Promise<boolean>>(),
    );

  /**
   * Holds the tab id of the workspace most recently published, retained after the user moves away so
   * a consumer that is not itself a workspace tab still resolves one.
   */
  private readonly lastWellTabId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the active tab's workspace root, or null when the active tab has none.
   */
  public readonly rootPath: Signal<string | null> = computed((): string | null => {
    const activeTabId: string | undefined = this.tabs.activeTabId();
    return activeTabId === undefined ? null : (this.roots().get(activeTabId) ?? null);
  });

  /**
   * Gets the workspace well to open into: the active tab's when it is a workspace, and otherwise the
   * one most recently active.
   *
   * The fallback is what makes this usable from somewhere that is not itself a workspace — an agent
   * docked to a terminal, say, whose active tab has no well of its own. Without it, the answer would
   * depend on which tab the user happened to be looking at when the agent acted.
   */
  public readonly activeWell: Signal<WorkspaceWell | null> = computed((): WorkspaceWell | null => {
    const wells: ReadonlyMap<string, (path: string) => Promise<boolean>> = this.wells();
    const activeTabId: string | undefined = this.tabs.activeTabId();
    const tabId: string | null =
      activeTabId !== undefined && wells.has(activeTabId) ? activeTabId : this.lastWellTabId();
    const open: ((path: string) => Promise<boolean>) | undefined =
      tabId === null ? undefined : wells.get(tabId);
    return tabId === null || open === undefined
      ? null
      : { tabId, root: this.roots().get(tabId) ?? null, open };
  });

  /**
   * Publishes a workspace tab's document well, so a file can be opened into it from the root.
   * @param tabId The owning tab's id.
   * @param open The opener that puts a file into the tab's well.
   */
  public setWell(tabId: string, open: (path: string) => Promise<boolean>): void {
    const next: Map<string, (path: string) => Promise<boolean>> = new Map<
      string,
      (path: string) => Promise<boolean>
    >(this.wells());
    next.set(tabId, open);
    this.wells.set(next);
    this.lastWellTabId.set(tabId);
    this.log.debug('ActiveWorkspace', `Tab '${tabId}' well published`);
  }

  /**
   * Drops a tab's published well when the tab closes.
   * @param tabId The owning tab's id.
   */
  public clearWell(tabId: string): void {
    if (!this.wells().has(tabId)) {
      return;
    }
    const next: Map<string, (path: string) => Promise<boolean>> = new Map<
      string,
      (path: string) => Promise<boolean>
    >(this.wells());
    next.delete(tabId);
    this.wells.set(next);
    if (this.lastWellTabId() === tabId) {
      // Fall back to any remaining workspace rather than to nothing, so closing one of two open
      // workspaces still leaves somewhere to open into.
      this.lastWellTabId.set([...next.keys()].at(-1) ?? null);
    }
    this.log.debug('ActiveWorkspace', `Tab '${tabId}' well cleared`);
  }

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
    this.log.debug('ActiveWorkspace', `Tab '${tabId}' root set`, rootPath);
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
    this.log.debug('ActiveWorkspace', `Tab '${tabId}' root cleared`);
  }
}
