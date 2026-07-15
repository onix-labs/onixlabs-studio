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
  RunConfigurationDescriptor,
} from '@shared/api/project-system';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * The kind of a Solution Explorer row, which decides its icon and click behaviour.
 */
export type SolutionRowKind = 'solution' | 'folder' | 'project' | 'item-folder' | 'file';

/**
 * The key of the synthetic solution root row that every other row nests under.
 */
const ROOT_KEY: string = 'solution-root';

/**
 * How many projects' contents are evaluated at once when a solution opens, bounding the number of
 * concurrent `dotnet` evaluations.
 */
const LOAD_CONCURRENCY: number = 4;

/**
 * How long, in milliseconds, external on-disk changes are debounced before the model reloads, so a
 * burst (a build, a checkout) reloads once rather than per file.
 */
const RELOAD_DEBOUNCE_MS: number = 300;

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
 * away, while eagerly evaluating every project's contents up front so expansion never waits. Each
 * project carries its own loading spinner, shown until that project's contents have loaded. Exposes the
 * model's presence (which the directory view uses to show or hide the panel) and a flattened row list
 * the panel renders. Provided per directory tab. Outside Electron the bridge is absent and the model
 * stays null.
 */
@Service()
export class SolutionModel {
  /**
   * Holds this tab's workspace, whose root the model is built for.
   */
  private readonly workspace: Workspace = inject(Workspace);

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
   * Gets the run configurations discovered from the active root — the Run dropdown's fallback until
   * persisted `.studio` run configurations exist.
   */
  public readonly runConfigurations: Signal<readonly RunConfigurationDescriptor[]> = computed(
    (): readonly RunConfigurationDescriptor[] => this.current()?.runConfigurations ?? [],
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
    const rows: SolutionRow[] = [
      this.row(ROOT_KEY, 0, this.solutionName(model), 'solution', true, expanded, loading, null),
    ];
    if (expanded) {
      if (filtering) {
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
   * Toggles a row's expansion. Contents are already loaded, so expansion never fetches.
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
    }
    this.expandedKeys.set(next);
  }

  /**
   * Sets the search query that filters the tree, or clears it when empty.
   * @param value The query text.
   */
  public setQuery(value: string): void {
    this.searchQuery.set(value);
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
      void this.loadAllContents(model, generation);
    }
  }

  /**
   * Handles a burst of external on-disk changes under the root, scheduling a debounced reload. Bursts
   * confined to the repository's `.git` directory are ignored: they change no project structure, and
   * every git operation would otherwise re-evaluate the solution.
   * @param root The workspace root the changes occurred under.
   * @param event The change burst.
   */
  private onTreeChanged(root: string, event: DirectoryChangeEvent): void {
    if (!event.overflow && event.directories.every(this.isGitInternal.bind(this, root))) {
      return;
    }
    this.cancelReload();
    this.reloadTimer = setTimeout((): void => {
      this.reloadTimer = null;
      void this.reload(root);
    }, RELOAD_DEBOUNCE_MS);
  }

  /**
   * Cancels any pending debounced reload.
   */
  private cancelReload(): void {
    if (this.reloadTimer !== null) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  /**
   * Determines whether a directory lies within the root's `.git` directory.
   * @param root The workspace root.
   * @param directory The absolute directory path to test.
   * @returns Returns true when the directory is the `.git` directory or inside it.
   */
  private isGitInternal(root: string, directory: string): boolean {
    const normalizedRoot: string = root.replaceAll('\\', '/');
    const normalized: string = directory.replaceAll('\\', '/');
    const gitDirectory: string = `${normalizedRoot}/.git`;
    return normalized === gitDirectory || normalized.startsWith(`${gitDirectory}/`);
  }

  /**
   * Reloads the model for the current root after its contents changed on disk, preserving the
   * expansion state (unlike {@link refresh}, which resets it for a newly-opened root). Projects whose
   * contents were already loaded keep showing them until their fresh contents arrive, so the tree does
   * not flash back to spinners on every external change. A stale response is discarded.
   * @param root The workspace root to reload.
   * @returns Returns a promise that resolves once the model has been reloaded.
   */
  private async reload(root: string): Promise<void> {
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
    // Spinners only for projects the cache knows nothing about; known projects keep their previous
    // contents visible until the fresh contents replace them below.
    const cache: ReadonlyMap<string, ProjectItems> = this.itemsByProject();
    const loading: Set<string> = new Set<string>();
    for (const project of model.projects) {
      if (!cache.has(project.path)) {
        loading.add(project.path);
      }
    }
    this.loadingProjects.set(loading);
    void this.loadAllContents(model, generation);
  }

  /**
   * Replaces the model and resets the tree state, collapsing everything but the solution root, and
   * marking every project as loading so each carries its own spinner until its contents arrive. The
   * tree stays collapsed to the root; the user expands the projects and folders they want.
   * @param model The new model, or null to clear.
   */
  private reset(model: ProjectModel | null): void {
    this.current.set(model);
    this.itemsByProject.set(new Map<string, ProjectItems>());
    this.searchQuery.set('');
    this.selectedKeySignal.set(null);
    // Start collapsed to just the solution root; every project shows its own spinner while it loads.
    const loading: Set<string> = new Set<string>();
    const expanded: Set<string> = new Set<string>();
    if (model !== null) {
      for (const project of model.projects) {
        loading.add(project.path);
      }
      expanded.add(ROOT_KEY);
    }
    this.loadingProjects.set(loading);
    this.expandedKeys.set(expanded);
  }

  /**
   * Eagerly evaluates every project's contents, a bounded number at a time, populating the cache and
   * clearing each project's spinner as it completes — whether or not it yielded contents, so a spinner
   * never spins forever. Applies nothing once superseded.
   * @param model The model whose projects are loaded.
   * @param generation The load generation this work belongs to.
   * @returns Returns a promise that resolves once loading completes.
   */
  private async loadAllContents(model: ProjectModel, generation: number): Promise<void> {
    const queue: ProjectEntry[] = [...model.projects];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (
        let next: ProjectEntry | undefined = queue.shift();
        next !== undefined;
        next = queue.shift()
      ) {
        const items: ProjectItems | null =
          (await this.bridge?.invoke<ProjectItems | null>(ProjectChannel.ItemsLoad, next.path)) ??
          null;
        if (generation !== this.generation) {
          return;
        }
        if (items !== null) {
          const cache: Map<string, ProjectItems> = new Map<string, ProjectItems>(
            this.itemsByProject(),
          );
          cache.set(items.projectPath, items);
          this.itemsByProject.set(cache);
        }
        this.clearLoading(next.path);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(LOAD_CONCURRENCY, queue.length) },
        (): Promise<void> => worker(),
      ),
    );
  }

  /**
   * Clears a project's loading state, removing its spinner.
   * @param path The path of the project that finished loading.
   */
  private clearLoading(path: string): void {
    const loading: Set<string> = new Set<string>(this.loadingProjects());
    loading.delete(path);
    this.loadingProjects.set(loading);
  }

  /**
   * Resolves the solution root's display name: the solution file's name, or the root folder's name when
   * the model was assembled from loose projects.
   * @param model The model.
   * @returns Returns the root display name.
   */
  private solutionName(model: ProjectModel): string {
    if (model.solution !== null) {
      return model.solution.name;
    }
    const segments: string[] = model.root.replace(/[/\\]+$/, '').split(/[/\\]/);
    return segments[segments.length - 1] || model.root;
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
        // A loading project hides its caret and cannot be expanded until its contents arrive.
        rows.push(
          this.row(key, depth, node.name, 'project', !loading, expanded, loading, node.path),
        );
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
            this.row(key, depth, node.name, 'project', !loading, childMatched, loading, node.path),
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
