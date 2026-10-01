import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AiBridgeScope } from '@shared/api/ai-types';
import { Log } from '@shared/angular/services/log/log';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * One document open in a workspace's well, as reported to an agent (#713).
 */
export interface WellDocument {
  /**
   * Gets the document's absolute path, or null for one not yet saved.
   */
  readonly path: string | null;

  /**
   * Gets the document's display name.
   */
  readonly name: string;

  /**
   * Gets the document's language identifier.
   */
  readonly language: string;

  /**
   * Gets whether the document has unsaved changes.
   */
  readonly dirty: boolean;

  /**
   * Gets whether the document is the one the user is looking at.
   */
  readonly active: boolean;
}

/**
 * One changed file in a workspace's repository, as reported to an agent.
 */
export interface WellChange {
  /**
   * Gets the path relative to the repository root.
   */
  readonly path: string;

  /**
   * Gets the change's status, in git's vocabulary (`modified`, `added`, `deleted`, `renamed`, …).
   */
  readonly status: string;
}

/**
 * A workspace's source-control state, as reported to an agent: what the source-control sidebar shows,
 * worktree-aware, and available to a harness that has no shell to run `git status` with.
 */
export interface WellSourceControl {
  /**
   * Gets the repository root.
   */
  readonly root: string;

  /**
   * Gets the current branch, or null when detached.
   */
  readonly branch: string | null;

  /**
   * Gets the upstream branch, or null when there is none.
   */
  readonly upstream: string | null;

  /**
   * Gets how many commits the branch is ahead of its upstream.
   */
  readonly ahead: number;

  /**
   * Gets how many commits the branch is behind its upstream.
   */
  readonly behind: number;

  /**
   * Gets the staged changes.
   */
  readonly staged: readonly WellChange[];

  /**
   * Gets the unstaged changes.
   */
  readonly unstaged: readonly WellChange[];

  /**
   * Gets the conflicted files.
   */
  readonly conflicted: readonly WellChange[];
}

/**
 * One terminal in a workspace's dock, as reported to an agent (#713).
 */
export interface WellTerminal {
  /**
   * Gets the terminal's identifier, which the terminal tools address it by.
   */
  readonly id: string;

  /**
   * Gets the terminal's display name.
   */
  readonly name: string;

  /**
   * Gets whether the terminal is the one selected in the panel.
   */
  readonly active: boolean;
}

/**
 * What a workspace tab publishes about its well: the handlers a global consumer — the agent's
 * workbench tools — reaches it through, because the services behind them are workspace-scoped and
 * unreachable from the root.
 */
export interface WorkspaceWellHandlers {
  /**
   * Reads the workspace's root directory.
   * @returns Returns the root, or null when the view has no folder open yet.
   */
  rootPath(): string | null;

  /**
   * Reads which of the well's documents the user is looking at, so an agent docked in this workspace
   * reads THIS workspace's focused document rather than whichever editor is focused app-wide.
   * @returns Returns the document's id, or null when the well is empty.
   */
  activeDocumentId(): string | null;

  /**
   * Opens a file into the well, reusing its panel when the file is already open.
   * @param path The absolute path of the file to open.
   * @returns Returns true when the file was opened.
   */
  open(path: string): Promise<boolean>;

  /**
   * Opens a changed file's diff — working tree against HEAD — into the well.
   * @param path The absolute path of the file.
   * @returns Returns null when the diff was opened, or the reason it could not be.
   */
  openDiff(path: string): Promise<string | null>;

  /**
   * Lists the documents open in the well.
   * @returns Returns the documents, in the well's order.
   */
  documents(): readonly WellDocument[];

  /**
   * Reads the workspace's source-control state.
   * @returns Returns the state, or null when the folder is not a repository.
   */
  sourceControl(): WellSourceControl | null;

  /**
   * Opens a new terminal in the workspace's dock, rooted at the workspace, and reveals it.
   * @returns Returns the terminal.
   */
  openTerminal(): WellTerminal;

  /**
   * Lists the terminals in the workspace's dock.
   * @returns Returns the terminals, in the panel's order.
   */
  terminals(): readonly WellTerminal[];

  /**
   * Creates a file in the workspace, writes its content when given, reveals it in the Explorer and
   * opens it in the well.
   * @param path The absolute path of the file to create.
   * @param content The content to write, or null for an empty file.
   * @returns Returns null when the file was created, or the reason it could not be.
   */
  createFile(path: string, content: string | null): Promise<string | null>;

  /**
   * Creates a folder in the workspace and reveals it in the Explorer.
   * @param path The absolute path of the folder to create.
   * @returns Returns null when the folder was created, or the reason it could not be.
   */
  createFolder(path: string): Promise<string | null>;

  /**
   * Renames a file or folder in place.
   * @param path The absolute path of the entry.
   * @param name The new name, a single path segment.
   * @returns Returns the new absolute path, or the reason the entry could not be renamed.
   */
  rename(
    path: string,
    name: string,
  ): Promise<{ readonly path: string | null; readonly error: string | null }>;

  /**
   * Deletes a file or folder, to the operating system's trash where the platform allows it.
   * @param path The absolute path of the entry.
   * @returns Returns whether it went to the trash, or the reason it could not be deleted.
   */
  delete(path: string): Promise<{ readonly trashed: boolean; readonly error: string | null }>;

  /**
   * Reveals a file or folder in the Explorer: expands the tree down to it and selects it.
   * @param path The absolute path of the entry.
   * @returns Returns true when the entry lies within the workspace and was revealed.
   */
  reveal(path: string): Promise<boolean>;
}

/**
 * A workspace tab's document well, published so a global consumer can reach it without depending on
 * that tab's injector.
 */
export interface WorkspaceWell extends WorkspaceWellHandlers {
  /**
   * Gets the well's key: the publishing view's scope id — the tab id, or the tab id qualified by the
   * checkout for a worktree sub-view. An agent docked in the workspace runs with this as its owner.
   */
  readonly scope: string;

  /**
   * Gets the id of the tab whose well this is, so a caller can bring it to the front.
   */
  readonly tabId: string;

  /**
   * Gets the workspace's root directory, or null when the tab has no folder open yet.
   */
  readonly root: string | null;
}

/**
 * A well as published: its handlers and the top-level tab it lives in.
 */
interface PublishedWell {
  /**
   * Gets the id of the top-level tab the well lives in.
   */
  readonly tabId: string;

  /**
   * Gets what the well can do.
   */
  readonly handlers: WorkspaceWellHandlers;
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
   * Holds each workspace view's published well, keyed by the view's scope id — NOT the tab id: a
   * worktree container hosts one view per checkout in a single tab, and keying by tab let each
   * sub-view overwrite the others, so one checkout's agent acted on another's well.
   */
  private readonly wells: WritableSignal<ReadonlyMap<string, PublishedWell>> = signal<
    ReadonlyMap<string, PublishedWell>
  >(new Map<string, PublishedWell>());

  /**
   * Holds the scope of the well most recently published, retained after the user moves away so a
   * consumer that is not itself in a workspace still resolves one.
   */
  private readonly lastWellScope: WritableSignal<string | null> = signal<string | null>(null);

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
   * docked to a terminal tab, say, whose active tab has no well of its own.
   *
   * ⛔ NOT for an agent docked IN a workspace: resolve that agent's well with {@link wellForRun}. This
   * follows the user's focus, so an agent in a background workspace reading it reaches the foreground
   * workspace's documents and terminals — the isolation bug this seam once had.
   */
  public readonly activeWell: Signal<WorkspaceWell | null> = computed((): WorkspaceWell | null => {
    const wells: ReadonlyMap<string, PublishedWell> = this.wells();
    const activeTabId: string | undefined = this.tabs.activeTabId();
    const last: string | null = this.lastWellScope();
    const lastWell: PublishedWell | undefined = last === null ? undefined : wells.get(last);
    if (activeTabId !== undefined) {
      // Prefer the sub-view the user last touched within the active tab, then any of its views.
      if (last !== null && lastWell?.tabId === activeTabId) {
        return this.project(last, lastWell);
      }
      const inTab: [string, PublishedWell] | undefined = [...wells.entries()]
        .reverse()
        .find(([, well]: [string, PublishedWell]): boolean => well.tabId === activeTabId);
      if (inTab !== undefined) {
        return this.project(inTab[0], inTab[1]);
      }
    }
    return last === null || lastWell === undefined ? null : this.project(last, lastWell);
  });

  /**
   * Resolves the well a run acts on, from the run's own trusted scope rather than the user's focus.
   *
   * - A run whose owner IS a well (an agent docked in a workspace) gets that well and nothing else.
   * - A `workspace`-surface run that owns no well gets null — never a borrowed one.
   * - Any other run gets the well whose root it is acting within, when one is open.
   * - Failing that, and only when `fallback` is set, the {@link activeWell} — for an agent outside any
   *   workspace (a terminal or agent tab) opening a file somewhere the user can see it.
   * @param scope The run's bridge scope.
   * @param fallback Whether to fall back to the focused workspace when the run belongs to none.
   * @returns Returns the well, or null when the run has none.
   */
  public wellForRun(scope: AiBridgeScope, fallback: boolean = true): WorkspaceWell | null {
    const wells: ReadonlyMap<string, PublishedWell> = this.wells();
    if (scope.owningTabId !== null) {
      const owned: PublishedWell | undefined = wells.get(scope.owningTabId);
      if (owned !== undefined) {
        return this.project(scope.owningTabId, owned);
      }
    }
    if (scope.surface === 'workspace') {
      this.log.warn('ActiveWorkspace', 'Workspace run owns no published well', scope.owningTabId);
      return null;
    }
    if (scope.workspaceRoot !== null) {
      const byRoot: [string, PublishedWell] | undefined = [...wells.entries()].find(
        ([, well]: [string, PublishedWell]): boolean =>
          well.handlers.rootPath() === scope.workspaceRoot,
      );
      if (byRoot !== undefined) {
        return this.project(byRoot[0], byRoot[1]);
      }
    }
    return fallback ? this.activeWell() : null;
  }

  /**
   * Finds the well whose dock holds a terminal, so a terminal tool can refuse a terminal that belongs
   * to another workspace.
   * @param terminalId The terminal's id.
   * @returns Returns the owning well, or null when the terminal is in no workspace (a top-level tab).
   */
  public wellOwningTerminal(terminalId: string): WorkspaceWell | null {
    for (const [scope, well] of this.wells()) {
      if (
        well.handlers
          .terminals()
          .some((terminal: WellTerminal): boolean => terminal.id === terminalId)
      ) {
        return this.project(scope, well);
      }
    }
    return null;
  }

  /**
   * Publishes a workspace view's document well, so it can be reached from the root.
   * @param scope The publishing view's scope id (the well's key).
   * @param tabId The owning top-level tab's id.
   * @param handlers What the well can do.
   */
  public setWell(scope: string, tabId: string, handlers: WorkspaceWellHandlers): void {
    const next: Map<string, PublishedWell> = new Map<string, PublishedWell>(this.wells());
    next.set(scope, { tabId, handlers });
    this.wells.set(next);
    this.lastWellScope.set(scope);
    this.log.debug('ActiveWorkspace', `Well '${scope}' published (tab '${tabId}')`);
  }

  /**
   * Drops a view's published well when the view is torn down. Identity-checked, so a predecessor
   * destroyed after its successor published under the same scope does not take the successor's well
   * with it.
   * @param scope The view's scope id.
   * @param handlers The handlers the view published, or undefined to drop whatever is there.
   */
  public clearWell(scope: string, handlers?: WorkspaceWellHandlers): void {
    const current: PublishedWell | undefined = this.wells().get(scope);
    if (current === undefined || (handlers !== undefined && current.handlers !== handlers)) {
      return;
    }
    const next: Map<string, PublishedWell> = new Map<string, PublishedWell>(this.wells());
    next.delete(scope);
    this.wells.set(next);
    if (this.lastWellScope() === scope) {
      // Fall back to any remaining workspace rather than to nothing, so closing one of two open
      // workspaces still leaves somewhere to open into.
      this.lastWellScope.set([...next.keys()].at(-1) ?? null);
    }
    this.log.debug('ActiveWorkspace', `Well '${scope}' cleared`);
  }

  /**
   * Projects a published well into the {@link WorkspaceWell} consumers see.
   * @param scope The well's key.
   * @param well The published well.
   * @returns Returns the projected well.
   */
  private project(scope: string, well: PublishedWell): WorkspaceWell {
    return { scope, tabId: well.tabId, root: well.handlers.rootPath(), ...well.handlers };
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
