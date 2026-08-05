import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { ProjectChannel } from '@shared/api/project-channels';
import {
  ProjectCapabilities,
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '@shared/api/project-system';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * The kind of a Solution Explorer row, which decides its icon and click behaviour.
 */
export type SolutionRowKind = 'solution' | 'folder' | 'project' | 'item-folder' | 'file';

/**
 * The key of the synthetic workspace root row that every other row nests under. Its label is the
 * workspace's display name (name plus branch), never a path segment.
 */
const ROOT_KEY: string = 'solution-root';

/**
 * How many projects' contents are evaluated at once by the background sweep. Deliberately 1: each
 * evaluation is a full MSBuild process, and the sweep runs while the language server is loading the
 * same solution — a wider sweep saturated the machine on large solutions. Expanding or revealing a
 * project jumps the queue and fetches immediately, so the trickle costs the user nothing.
 */
const BACKGROUND_LOAD_CONCURRENCY: number = 1;

/**
 * How long, in milliseconds, external on-disk changes are debounced before the model reloads, so a
 * burst (a build, a checkout) reloads once rather than per file.
 */
const RELOAD_DEBOUNCE_MS: number = 300;

/**
 * How long, in milliseconds, search-query keystrokes are debounced before the tree filter runs.
 */
const QUERY_DEBOUNCE_MS: number = 150;

/**
 * A flattened Solution Explorer row: one visible line of the tree, with its depth, expansion, and
 * loading state already resolved so the view renders it directly.
 */
export interface SolutionRow {
  /**
   * Holds the row's stable identity, used to toggle its expansion and as the render key.
   */
  readonly key: string;

  /**
   * Holds the row's depth in the tree.
   */
  readonly depth: number;

  /**
   * Holds the row's display label.
   */
  readonly label: string;

  /**
   * Holds the row's kind.
   */
  readonly kind: SolutionRowKind;

  /**
   * Holds whether the row can be expanded.
   */
  readonly expandable: boolean;

  /**
   * Holds whether the row is currently expanded.
   */
  readonly expanded: boolean;

  /**
   * Holds whether the row shows a loading spinner: a project while its own contents load, and a folder
   * or the solution root while any project beneath it is still loading.
   */
  readonly loading: boolean;

  /**
   * Holds the absolute path the row opens (a project or file), or null when it opens nothing.
   */
  readonly path: string | null;
}

/**
 * Holds and drives this tab's Solution Explorer. When a .NET workspace opens, it fetches the logical
 * project model for the root and shows the full structure — solution folders and projects — straight
 * away, while a low-priority background sweep evaluates project contents one at a time (so search and
 * expand-all eventually cover everything without saturating the machine at open). Expanding or
 * revealing a project jumps the queue and fetches its contents immediately; a project carries a
 * spinner while its fetch is in flight. External change bursts reload only the projects whose
 * directories actually changed. Exposes the model's presence (which the directory view uses to show
 * or hide the panel) and a flattened row list the panel renders. Provided per directory tab. Outside
 * Electron the bridge is absent and the model stays null.
 */
@Service()
export class SolutionModel {
  /**
   * Holds this tab's workspace, whose root the model is built for.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the view's dock context, whose display name titles the workspace root row.
   */
  private readonly context: DockTabContext = inject(DockTabContext);

  /**
   * Holds the directory-watch service the root is subscribed to, so external on-disk changes reload
   * the model.
   */
  private readonly directoryWatch: DirectoryWatch = inject(DirectoryWatch);

  /**
   * Holds the pending debounced reload timer, or null when none is scheduled.
   */
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the pending debounced search-query timer, or null when none is scheduled.
   */
  private queryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the changed directories accumulated for the pending debounced reload, or null when the
   * whole tree must be treated as changed (an overflow burst), or undefined when no reload is
   * pending. Drives the targeted reload: only projects whose directories appear here re-evaluate.
   */
  private pendingChangedDirs: Set<string> | null | undefined = undefined;

  /**
   * Holds the background evaluation queue for the current load generation: the paths of the projects
   * whose contents have not been fetched yet, drained one at a time.
   */
  private queue: string[] = [];

  /**
   * Holds the number of fetches currently running from the background queue.
   */
  private activeWorkers: number = 0;

  /**
   * Holds the paths of the projects whose contents fetch is currently in flight (from the queue or a
   * priority request), so the same project is never fetched twice concurrently.
   */
  private readonly inFlight: Set<string> = new Set<string>();

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the current model, or null when no root is open or none was recognised.
   */
  private readonly current: WritableSignal<ProjectModel | null> = signal<ProjectModel | null>(null);

  /**
   * Holds the keys of the currently expanded rows.
   */
  private readonly expandedKeys: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the loaded contents of each project, keyed by project path. Populated up front as the
   * solution loads.
   */
  private readonly itemsByProject: WritableSignal<ReadonlyMap<string, ProjectItems>> = signal<
    ReadonlyMap<string, ProjectItems>
  >(new Map<string, ProjectItems>());

  /**
   * Holds the paths of the projects whose contents are still loading, so each shows its own spinner
   * until its contents arrive.
   */
  private readonly loadingProjects: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Holds the active search query. While non-empty the tree is filtered to the rows whose label
   * contains it (and their ancestors), with the matching branches force-expanded.
   */
  private readonly searchQuery: WritableSignal<string> = signal<string>('');

  /**
   * Holds the key of the selected row, or null when nothing is selected.
   */
  private readonly selectedKeySignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the generation of the current load, so a stale load (the root changed while it was in flight)
   * does not apply its results.
   */
  private generation: number = 0;

  /**
   * Gets the current project model, or null when there is none.
   */
  public readonly model: Signal<ProjectModel | null> = this.current.asReadonly();

  /**
   * Gets the active project's declared capabilities, or null when there is no model. Exposed so the
   * ribbon can gate its optional controls from data; the model itself carries the descriptor.
   */
  public readonly capabilities: Signal<ProjectCapabilities | null> = computed(
    (): ProjectCapabilities | null => this.current()?.capabilities ?? null,
  );

  /**
   * Gets the active search query, exposed so the panel can highlight the matched text.
   */
  public readonly query: Signal<string> = this.searchQuery.asReadonly();

  /**
   * Gets the key of the selected row, or null when nothing is selected.
   */
  public readonly selectedKey: Signal<string | null> = this.selectedKeySignal.asReadonly();

  /**
   * Gets the flattened, visible rows of the solution tree.
   */
  public readonly rows: Signal<readonly SolutionRow[]> = computed((): readonly SolutionRow[] => {
    const model: ProjectModel | null = this.current();
    if (model === null) {
      return [];
    }
    // While searching, the root is force-expanded so the matches it nests show.
    const query: string = this.searchQuery().trim().toLowerCase();
    const filtering: boolean = query.length > 0;
    const expanded: boolean = filtering || this.expandedKeys().has(ROOT_KEY);
    // The root shows its full structure immediately, and spins while any project anywhere beneath it is
    // still loading (each project and the folders above it carry the same aggregate spinner).
    const loading: boolean = this.loadingProjects().size > 0;
    // The root row is the WORKSPACE — its display name (name plus branch), never a GUID path
    // segment; the raw folder name is only the pre-announcement fallback. The structure nests
    // directly beneath it: neither the solution file nor a lone root-level project gets a row of
    // its own — each would only repeat the repository's name.
    const rootLabel: string = this.context.displayName() ?? this.folderName(model.root);
    const rows: SolutionRow[] = [
      this.row(ROOT_KEY, 0, rootLabel, 'solution', true, expanded, loading, null),
    ];
    const hoisted: string | null = this.hoistedProjectPath(model);
    if (expanded) {
      if (hoisted !== null) {
        const items: ProjectItems | undefined = this.itemsByProject().get(hoisted);
        if (items !== undefined) {
          if (filtering) {
            this.appendItemsFiltered(items.tree, 1, `project:${hoisted}`, rows, query);
          } else {
            this.appendItems(items.tree, 1, `project:${hoisted}`, rows);
          }
        }
      } else if (filtering) {
        this.appendNodesFiltered(model.tree, 1, '', rows, query);
      } else {
        this.appendNodes(model.tree, 1, '', rows);
      }
    }
    return rows;
  });

  /**
   * Initializes a new instance of the {@link SolutionModel} class, refreshing the model whenever the
   * open root changes and reloading it (preserving expansion) when the root's contents change on disk
   * outside the application.
   */
  public constructor() {
    effect((onCleanup: (fn: () => void) => void): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      void this.refresh(root);
      if (root === null) {
        return;
      }
      const dispose: () => void = this.directoryWatch.watch(
        root,
        (event: DirectoryChangeEvent): void => this.onTreeChanged(root, event),
      );
      onCleanup((): void => {
        dispose();
        this.cancelReload();
      });
    });
  }

  /**
   * Toggles a row's expansion. Expanding a project whose contents have not arrived yet requests them
   * ahead of the background sweep; its children appear (under its spinner) when they do.
   * @param row The row to toggle.
   */
  public toggle(row: SolutionRow): void {
    if (!row.expandable) {
      return;
    }
    const next: Set<string> = new Set<string>(this.expandedKeys());
    if (next.has(row.key)) {
      next.delete(row.key);
    } else {
      next.add(row.key);
      if (row.kind === 'project' && row.path !== null) {
        this.requestItems(row.path);
      }
    }
    this.expandedKeys.set(next);
  }

  /**
   * Sets the search query that filters the tree, or clears it when empty. Debounced: filtering
   * force-expands every matching branch and rebuilds the whole row list, so it must not run per
   * keystroke of a fast typist on a large solution.
   * @param value The query text.
   */
  public setQuery(value: string): void {
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
    }
    this.queryTimer = setTimeout((): void => {
      this.queryTimer = null;
      this.searchQuery.set(value);
    }, QUERY_DEBOUNCE_MS);
  }

  /**
   * Selects a row by key.
   * @param key The key of the row to select.
   */
  public select(key: string): void {
    this.selectedKeySignal.set(key);
  }

  /**
   * Reveals a file in the tree: expands the chain of rows leading to it (the root, its solution
   * folders, its project, and its item folders) and selects its row. Used to keep the Solution
   * Explorer's selection following the active document. Does nothing when the file is not part of a
   * loaded project (its contents may still be loading, or the file lies outside the solution).
   * @param path The absolute path of the file to reveal.
   * @returns Returns true when the file was found and revealed.
   */
  public revealPath(path: string): boolean {
    const model: ProjectModel | null = this.current();
    if (model === null) {
      return false;
    }
    const chain: readonly string[] | null = this.keysToFile(model, path);
    if (chain === null) {
      // The file may belong to a project whose contents have not arrived yet: request them ahead of
      // the background sweep so a later reveal (the next activation, the next document switch) lands.
      this.warmOwningProject(model, path);
      return false;
    }
    this.expandedKeys.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      for (const key of chain) {
        next.add(key);
      }
      return next;
    });
    this.selectedKeySignal.set(`file:${path}`);
    return true;
  }

  /**
   * Finds the chain of expandable keys leading to a file: the solution root, the solution folders
   * above its project, the project itself, and the item folders above the file.
   * @param model The model to walk.
   * @param path The absolute file path to find.
   * @returns Returns the ancestor keys, or null when the file is not in a loaded project.
   */
  private keysToFile(model: ProjectModel, path: string): readonly string[] | null {
    const walkItems: (
      nodes: readonly ProjectItemNode[],
      parentKey: string,
      ancestors: readonly string[],
    ) => readonly string[] | null = (
      nodes: readonly ProjectItemNode[],
      parentKey: string,
      ancestors: readonly string[],
    ): readonly string[] | null => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          const found: readonly string[] | null = walkItems(node.children, key, [
            ...ancestors,
            key,
          ]);
          if (found !== null) {
            return found;
          }
        } else if (node.path === path) {
          return ancestors;
        }
      }
      return null;
    };
    const walkNodes: (
      nodes: readonly ProjectNode[],
      parentKey: string,
      ancestors: readonly string[],
    ) => readonly string[] | null = (
      nodes: readonly ProjectNode[],
      parentKey: string,
      ancestors: readonly string[],
    ): readonly string[] | null => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          const found: readonly string[] | null = walkNodes(node.children, key, [
            ...ancestors,
            key,
          ]);
          if (found !== null) {
            return found;
          }
        } else {
          const key: string = `project:${node.path}`;
          const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
          if (items !== undefined) {
            const found: readonly string[] | null = walkItems(items.tree, key, [...ancestors, key]);
            if (found !== null) {
              return found;
            }
          }
        }
      }
      return null;
    };
    return walkNodes(model.tree, '', [ROOT_KEY]);
  }

  /**
   * Requests the contents of the project a file lies within (by deepest directory prefix) when they
   * are not loaded yet, so features that need the file's tree position can find it shortly.
   * @param model The model to search.
   * @param path The absolute file path.
   */
  private warmOwningProject(model: ProjectModel, path: string): void {
    const normalized: string = path.replaceAll('\\', '/');
    let owner: string | null = null;
    let ownerDirectory: string = '';
    for (const project of model.projects) {
      const directory: string = project.path.replaceAll('\\', '/').replace(/\/[^/]*$/, '');
      if (normalized.startsWith(`${directory}/`) && directory.length > ownerDirectory.length) {
        owner = project.path;
        ownerDirectory = directory;
      }
    }
    if (owner !== null) {
      this.requestItems(owner);
    }
  }

  /**
   * Expands every node in the tree, so the whole structure is revealed.
   */
  public expandAll(): void {
    const model: ProjectModel | null = this.current();
    if (model !== null) {
      this.expandedKeys.set(this.allExpandableKeys(model));
    }
  }

  /**
   * Collapses every node in the tree, leaving only the solution root expanded so its top-level items
   * stay visible.
   */
  public collapseAll(): void {
    this.expandedKeys.set(new Set<string>([ROOT_KEY]));
  }

  /**
   * Loads the model for a root, clearing it (and all tree state) when there is no root or bridge, then
   * eagerly loading every project's contents. A stale response (the root changed again while the
   * request was in flight) is discarded.
   * @param root The workspace root, or null when none is open.
   * @returns Returns a promise that resolves once the model has been updated.
   */
  private async refresh(root: string | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.bridge === undefined || root === null) {
      this.reset(null);
      return;
    }
    const model: ProjectModel | null = await this.bridge.invoke<ProjectModel | null>(
      ProjectChannel.ModelLoad,
      root,
    );
    if (generation !== this.generation) {
      return;
    }
    this.reset(model);
    if (model !== null) {
      this.scheduleContents(
        model.projects.map((project: ProjectEntry): string => project.path),
        generation,
      );
    }
  }

  /**
   * Handles a burst of external on-disk changes under the root, accumulating the changed directories
   * and scheduling a debounced, targeted reload. Bursts confined to the repository's `.git` directory
   * or the workspace's `.studio` folder are ignored: they change no project structure, and every git
   * operation or settings write would otherwise re-evaluate the solution. An overflow burst reloads
   * everything — the watcher drops build-output and dependency churn before it can overflow, so an
   * overflow means a genuinely tree-wide change (a large checkout) that may well have changed project
   * structure.
   * @param root The workspace root the changes occurred under.
   * @param event The change burst.
   */
  private onTreeChanged(root: string, event: DirectoryChangeEvent): void {
    const relevant: string[] = event.directories.filter(
      (directory: string): boolean => !this.isReloadExempt(root, directory),
    );
    if (!event.overflow && relevant.length === 0) {
      return;
    }
    if (event.overflow) {
      this.pendingChangedDirs = null;
    } else if (this.pendingChangedDirs !== null) {
      this.pendingChangedDirs ??= new Set<string>();
      for (const directory of relevant) {
        this.pendingChangedDirs.add(directory);
      }
    }
    if (this.reloadTimer !== null) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout((): void => {
      this.reloadTimer = null;
      const changed: ReadonlySet<string> | null = this.pendingChangedDirs ?? null;
      this.pendingChangedDirs = undefined;
      void this.reload(root, changed);
    }, RELOAD_DEBOUNCE_MS);
  }

  /**
   * Cancels any pending debounced reload and discards its accumulated changes.
   */
  private cancelReload(): void {
    if (this.reloadTimer !== null) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.pendingChangedDirs = undefined;
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
      this.queryTimer = null;
    }
  }

  /**
   * Determines whether a directory's changes are exempt from triggering a solution reload: the
   * repository's `.git` directory and the workspace's `.studio` folder hold no project structure.
   * @param root The workspace root.
   * @param directory The absolute directory path to test.
   * @returns Returns true when the directory is an exempt folder or inside one.
   */
  private isReloadExempt(root: string, directory: string): boolean {
    const normalizedRoot: string = root.replaceAll('\\', '/');
    const normalized: string = directory.replaceAll('\\', '/');
    return ['.git', '.studio'].some((exempt: string): boolean => {
      const exemptDirectory: string = `${normalizedRoot}/${exempt}`;
      return normalized === exemptDirectory || normalized.startsWith(`${exemptDirectory}/`);
    });
  }

  /**
   * Reloads the model for the current root after its contents changed on disk, preserving the
   * expansion state (unlike {@link refresh}, which resets it for a newly-opened root). Projects whose
   * contents were already loaded keep showing them until their fresh contents arrive, so the tree does
   * not flash back to spinners on every external change — and only the projects whose directories
   * actually changed re-evaluate; the rest keep their cached contents untouched. A stale response is
   * discarded.
   * @param root The workspace root to reload.
   * @param changed The changed directories driving the reload, or null to treat everything as changed.
   * @returns Returns a promise that resolves once the model has been reloaded.
   */
  private async reload(root: string, changed: ReadonlySet<string> | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.bridge === undefined) {
      return;
    }
    const model: ProjectModel | null = await this.bridge.invoke<ProjectModel | null>(
      ProjectChannel.ModelLoad,
      root,
    );
    if (generation !== this.generation) {
      return;
    }
    this.current.set(model);
    if (model === null) {
      this.itemsByProject.set(new Map<string, ProjectItems>());
      this.loadingProjects.set(new Set<string>());
      this.expandedKeys.set(new Set<string>());
      return;
    }
    // Drop cached contents of projects that left the model, keep the rest visible while any fresh
    // contents arrive, and re-evaluate only what the burst could have affected: a project is skipped
    // when its contents are cached and none of the changed directories lie inside it.
    const cache: ReadonlyMap<string, ProjectItems> = this.itemsByProject();
    const kept: Map<string, ProjectItems> = new Map<string, ProjectItems>();
    const stale: string[] = [];
    for (const project of model.projects) {
      const items: ProjectItems | undefined = cache.get(project.path);
      if (items !== undefined) {
        kept.set(project.path, items);
      }
      if (items === undefined || changed === null || this.projectTouched(project.path, changed)) {
        stale.push(project.path);
      }
    }
    if (kept.size !== cache.size) {
      this.itemsByProject.set(kept);
    }
    this.scheduleContents(stale, generation);
  }

  /**
   * Determines whether any changed directory lies within a project's directory, so the project's
   * items (which live beneath it, links aside) may have changed.
   * @param projectPath The absolute project-file path.
   * @param changed The changed directories.
   * @returns Returns true when the project is touched by the burst.
   */
  private projectTouched(projectPath: string, changed: ReadonlySet<string>): boolean {
    const directory: string = projectPath.replaceAll('\\', '/').replace(/\/[^/]*$/, '');
    for (const candidate of changed) {
      const normalized: string = candidate.replaceAll('\\', '/');
      if (normalized === directory || normalized.startsWith(`${directory}/`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Replaces the model and resets the tree state, collapsing everything but the solution root. A
   * project carries a spinner only while its contents fetch is actually in flight, not while it waits
   * in the background queue.
   * @param model The new model, or null to clear.
   */
  private reset(model: ProjectModel | null): void {
    this.current.set(model);
    this.itemsByProject.set(new Map<string, ProjectItems>());
    this.searchQuery.set('');
    this.selectedKeySignal.set(null);
    this.loadingProjects.set(new Set<string>());
    this.expandedKeys.set(model !== null ? new Set<string>([ROOT_KEY]) : new Set<string>());
  }

  /**
   * Replaces the background evaluation queue with the given project paths and starts draining it, a
   * bounded number of fetches at a time. The queue belongs to the given load generation; a newer
   * refresh or reload replaces it wholesale.
   * @param paths The paths of the projects whose contents need (re-)evaluating.
   * @param generation The load generation this work belongs to.
   */
  private scheduleContents(paths: readonly string[], generation: number): void {
    this.queue = paths.filter((path: string): boolean => !this.inFlight.has(path));
    this.pump(generation);
  }

  /**
   * Drains the background queue up to the concurrency bound, fetching one project's contents per
   * worker and re-pumping as each completes. Stops when the generation is superseded.
   * @param generation The load generation the queue belongs to.
   */
  private pump(generation: number): void {
    while (
      this.activeWorkers < BACKGROUND_LOAD_CONCURRENCY &&
      this.queue.length > 0 &&
      generation === this.generation
    ) {
      const next: string = this.queue.shift()!;
      if (this.inFlight.has(next)) {
        continue;
      }
      this.activeWorkers += 1;
      void this.fetchItems(next, generation).finally((): void => {
        this.activeWorkers -= 1;
        this.pump(generation);
      });
    }
  }

  /**
   * Requests a project's contents ahead of the background sweep: called when the user expands or
   * reveals a project whose contents have not arrived yet, so their intent is never queued behind the
   * trickle. Already-loaded and already-fetching projects are left alone.
   * @param path The absolute project-file path.
   */
  private requestItems(path: string): void {
    if (this.itemsByProject().has(path) || this.inFlight.has(path)) {
      return;
    }
    this.queue = this.queue.filter((queued: string): boolean => queued !== path);
    void this.fetchItems(path, this.generation);
  }

  /**
   * Fetches one project's contents, marking it loading while the fetch is in flight and applying the
   * result unless the load generation has been superseded. The spinner clears whether or not the
   * evaluation yielded contents, so it never spins forever.
   * @param path The absolute project-file path.
   * @param generation The load generation this fetch belongs to.
   * @returns Returns a promise that resolves once the fetch has settled.
   */
  private async fetchItems(path: string, generation: number): Promise<void> {
    this.inFlight.add(path);
    this.setLoading(path, true);
    const items: ProjectItems | null =
      (await this.bridge?.invoke<ProjectItems | null>(ProjectChannel.ItemsLoad, path)) ?? null;
    this.inFlight.delete(path);
    if (generation !== this.generation) {
      return;
    }
    if (items !== null) {
      const cache: Map<string, ProjectItems> = new Map<string, ProjectItems>(this.itemsByProject());
      cache.set(items.projectPath, items);
      this.itemsByProject.set(cache);
    }
    this.setLoading(path, false);
  }

  /**
   * Sets or clears a project's loading state, showing or removing its spinner.
   * @param path The project path.
   * @param loading Whether the project's contents fetch is in flight.
   */
  private setLoading(path: string, loading: boolean): void {
    const next: Set<string> = new Set<string>(this.loadingProjects());
    if (loading) {
      next.add(path);
    } else {
      next.delete(path);
    }
    this.loadingProjects.set(next);
  }

  /**
   * Resolves the path of the project to hoist: when the model is a SINGLE project living in the
   * workspace root itself, its row would only repeat the workspace's name, so its contents render
   * directly under the root row instead. A single project in a subdirectory, or any multi-project
   * model, keeps its explicit rows.
   * @param model The model.
   * @returns Returns the hoisted project's path, or null when nothing is hoisted.
   */
  private hoistedProjectPath(model: ProjectModel): string | null {
    if (model.tree.length !== 1) {
      return null;
    }
    const only: ProjectNode = model.tree[0];
    if (only.type !== 'project') {
      return null;
    }
    const root: string = model.root.replace(/[/\\]+$/, '');
    const directory: string = only.path.replace(/[/\\][^/\\]*$/, '');
    return directory === root ? only.path : null;
  }

  /**
   * Resolves a root path's folder name.
   * @param root The root path.
   * @returns Returns the trailing path segment.
   */
  private folderName(root: string): string {
    const segments: string[] = root.replace(/[/\\]+$/, '').split(/[/\\]/);
    return segments[segments.length - 1] || root;
  }

  /**
   * Appends the rows for a run of solution nodes (folders and projects), in ascending name order,
   * recursing into the expanded ones.
   * @param nodes The nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   */
  private appendNodes(
    nodes: readonly ProjectNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
  ): void {
    for (const node of this.ordered(nodes)) {
      if (node.type === 'folder') {
        const key: string = `${parentKey}/${node.name}`;
        const expanded: boolean = this.expandedKeys().has(key);
        // The folder spins while any project beneath it is still loading.
        const loading: boolean = this.nodesLoading(node.children);
        rows.push(this.row(key, depth, node.name, 'folder', true, expanded, loading, null));
        if (expanded) {
          this.appendNodes(node.children, depth + 1, key, rows);
        }
      } else {
        const key: string = `project:${node.path}`;
        const expanded: boolean = this.expandedKeys().has(key);
        const loading: boolean = this.loadingProjects().has(node.path);
        // A project is always expandable: expanding one whose contents have not arrived requests
        // them ahead of the background sweep, and its children appear when they do.
        rows.push(this.row(key, depth, node.name, 'project', true, expanded, loading, node.path));
        const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
        if (expanded && items !== undefined) {
          this.appendItems(items.tree, depth + 1, key, rows);
        }
      }
    }
  }

  /**
   * Orders a run of solution nodes for display: solution folders first, then projects, with each group
   * sorted by name, ascending. The comparison is ordinal (by code unit) rather than locale-aware so that
   * the dot separator (which sorts below every letter) keeps a project directly above its more-qualified
   * siblings — for example `Foo.Bar`, then `Foo.Bar.UnitTests`, then `Foo.Bar.UnitTests.Data`.
   * @param nodes The nodes to order.
   * @returns Returns the nodes ordered folders-first, each group sorted by ascending name.
   */
  private ordered(nodes: readonly ProjectNode[]): readonly ProjectNode[] {
    const byName: (a: ProjectNode, b: ProjectNode) => number = (a, b): number =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    const folders: ProjectNode[] = nodes.filter((node: ProjectNode) => node.type === 'folder');
    const projects: ProjectNode[] = nodes.filter((node: ProjectNode) => node.type === 'project');
    return [...folders.sort(byName), ...projects.sort(byName)];
  }

  /**
   * Determines whether any project beneath a run of nodes is still loading, so a folder (and the root)
   * can carry the aggregate spinner until all of its projects have finished.
   * @param nodes The nodes to scan.
   * @returns Returns true when at least one descendant project is still loading.
   */
  private nodesLoading(nodes: readonly ProjectNode[]): boolean {
    return nodes.some((node: ProjectNode): boolean =>
      node.type === 'project'
        ? this.loadingProjects().has(node.path)
        : this.nodesLoading(node.children),
    );
  }

  /**
   * Appends the rows for a run of project-item nodes (folders and files), recursing into the expanded
   * folders.
   * @param nodes The item nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   */
  private appendItems(
    nodes: readonly ProjectItemNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
  ): void {
    for (const node of nodes) {
      if (node.type === 'folder') {
        const key: string = `${parentKey}/${node.name}`;
        const expanded: boolean = this.expandedKeys().has(key);
        rows.push(this.row(key, depth, node.name, 'item-folder', true, expanded, false, null));
        if (expanded) {
          this.appendItems(node.children, depth + 1, key, rows);
        }
      } else {
        rows.push(
          this.row(`file:${node.path}`, depth, node.name, 'file', false, false, false, node.path),
        );
      }
    }
  }

  /**
   * Appends the filtered rows for a run of solution nodes: a node is kept when its own name matches the
   * query or any of its descendants do, and a kept folder or project is force-expanded so its matching
   * descendants show. Ordering matches the unfiltered tree (folders first, each ascending).
   * @param nodes The nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   * @param query The lower-cased search query.
   * @returns Returns true when any row was appended (the run held a match).
   */
  private appendNodesFiltered(
    nodes: readonly ProjectNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
    query: string,
  ): boolean {
    let matched: boolean = false;
    for (const node of this.ordered(nodes)) {
      if (node.type === 'folder') {
        const key: string = `${parentKey}/${node.name}`;
        const childRows: SolutionRow[] = [];
        const childMatched: boolean = this.appendNodesFiltered(
          node.children,
          depth + 1,
          key,
          childRows,
          query,
        );
        if (this.matches(node.name, query) || childMatched) {
          const loading: boolean = this.nodesLoading(node.children);
          rows.push(this.row(key, depth, node.name, 'folder', true, childMatched, loading, null));
          rows.push(...childRows);
          matched = true;
        }
      } else {
        const key: string = `project:${node.path}`;
        const loading: boolean = this.loadingProjects().has(node.path);
        const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
        const childRows: SolutionRow[] = [];
        const childMatched: boolean =
          items !== undefined &&
          this.appendItemsFiltered(items.tree, depth + 1, key, childRows, query);
        if (this.matches(node.name, query) || childMatched) {
          rows.push(
            this.row(key, depth, node.name, 'project', true, childMatched, loading, node.path),
          );
          rows.push(...childRows);
          matched = true;
        }
      }
    }
    return matched;
  }

  /**
   * Appends the filtered rows for a run of project-item nodes: a file is kept when its name matches, and
   * a folder is kept (and force-expanded) when its name matches or any descendant does.
   * @param nodes The item nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   * @param query The lower-cased search query.
   * @returns Returns true when any row was appended (the run held a match).
   */
  private appendItemsFiltered(
    nodes: readonly ProjectItemNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
    query: string,
  ): boolean {
    let matched: boolean = false;
    for (const node of nodes) {
      if (node.type === 'folder') {
        const key: string = `${parentKey}/${node.name}`;
        const childRows: SolutionRow[] = [];
        const childMatched: boolean = this.appendItemsFiltered(
          node.children,
          depth + 1,
          key,
          childRows,
          query,
        );
        if (this.matches(node.name, query) || childMatched) {
          rows.push(
            this.row(key, depth, node.name, 'item-folder', true, childMatched, false, null),
          );
          rows.push(...childRows);
          matched = true;
        }
      } else if (this.matches(node.name, query)) {
        rows.push(
          this.row(`file:${node.path}`, depth, node.name, 'file', false, false, false, node.path),
        );
        matched = true;
      }
    }
    return matched;
  }

  /**
   * Determines whether a label matches the search query (a case-insensitive substring).
   * @param label The row label.
   * @param query The lower-cased search query.
   * @returns Returns true when the label contains the query.
   */
  private matches(label: string, query: string): boolean {
    return label.toLowerCase().includes(query);
  }

  /**
   * Collects the keys of every expandable row in the tree — the root, every solution folder and project,
   * and every loaded project's item folders — so expanding all reveals the whole structure.
   * @param model The model to walk.
   * @returns Returns the set of every expandable key.
   */
  private allExpandableKeys(model: ProjectModel): Set<string> {
    const keys: Set<string> = new Set<string>([ROOT_KEY]);
    const walkItems: (nodes: readonly ProjectItemNode[], parentKey: string) => void = (
      nodes: readonly ProjectItemNode[],
      parentKey: string,
    ): void => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          keys.add(key);
          walkItems(node.children, key);
        }
      }
    };
    const walkNodes: (nodes: readonly ProjectNode[], parentKey: string) => void = (
      nodes: readonly ProjectNode[],
      parentKey: string,
    ): void => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          keys.add(key);
          walkNodes(node.children, key);
        } else {
          const key: string = `project:${node.path}`;
          keys.add(key);
          const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
          if (items !== undefined) {
            walkItems(items.tree, key);
          }
        }
      }
    };
    walkNodes(model.tree, '');
    return keys;
  }

  /**
   * Builds a row.
   * @param key The row's identity.
   * @param depth The row's depth.
   * @param label The row's label.
   * @param kind The row's kind.
   * @param expandable Whether the row can be expanded.
   * @param expanded Whether the row is expanded.
   * @param loading Whether the row shows a spinner.
   * @param path The path the row opens, or null.
   * @returns Returns the row.
   */
  private row(
    key: string,
    depth: number,
    label: string,
    kind: SolutionRowKind,
    expandable: boolean,
    expanded: boolean,
    loading: boolean,
    path: string | null,
  ): SolutionRow {
    return { key, depth, label, kind, expandable, expanded, loading, path };
  }
}
