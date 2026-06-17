import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ProjectApi } from '../../../shared/studio-api';
import {
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '../../../shared/project-system';
import { Workspace } from '../workspace/workspace';

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
   * Holds whether the row shows a loading spinner (only the solution root, while contents load).
   */
  readonly loading: boolean;

  /**
   * Holds the absolute path the row opens (a project or file), or null when it opens nothing.
   */
  readonly path: string | null;
}

/**
 * Holds and drives this tab's Solution Explorer. When a .NET workspace opens, it fetches the logical
 * project model for the root and eagerly evaluates every project's contents up front, so the tree —
 * shown under a single solution root node — is fully populated and expansion never waits. The root node
 * carries the only loading spinner, shown until every project's contents have loaded. Exposes the
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
   * Holds the project-system bridge, or undefined when running outside Electron.
   */
  private readonly api: ProjectApi | undefined = window.studio?.project;

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
   * Holds whether the solution's contents are still loading, so the root node shows a spinner.
   */
  private readonly loadingContents: WritableSignal<boolean> = signal<boolean>(false);

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
   * Gets the flattened, visible rows of the solution tree.
   */
  public readonly rows: Signal<readonly SolutionRow[]> = computed((): readonly SolutionRow[] => {
    const model: ProjectModel | null = this.current();
    if (model === null) {
      return [];
    }
    const loading: boolean = this.loadingContents();
    const expanded: boolean = this.expandedKeys().has(ROOT_KEY);
    // The root cannot be expanded while its contents are still loading.
    const rows: SolutionRow[] = [
      this.row(ROOT_KEY, 0, this.solutionName(model), 'solution', !loading, expanded, loading, null),
    ];
    if (expanded) {
      this.appendNodes(model.tree, 1, '', rows);
    }
    return rows;
  });

  /**
   * Initializes a new instance of the {@link SolutionModel} class, refreshing the model whenever the
   * open root changes.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      void this.refresh(root);
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
   * Loads the model for a root, clearing it (and all tree state) when there is no root or bridge, then
   * eagerly loading every project's contents. A stale response (the root changed again while the
   * request was in flight) is discarded.
   * @param root The workspace root, or null when none is open.
   * @returns Returns a promise that resolves once the model has been updated.
   */
  private async refresh(root: string | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.api === undefined || root === null) {
      this.reset(null);
      return;
    }
    const model: ProjectModel | null = await this.api.loadModel(root);
    if (generation !== this.generation) {
      return;
    }
    this.reset(model);
    if (model !== null) {
      void this.loadAllContents(model, generation);
    }
  }

  /**
   * Replaces the model and resets the tree state, expanding the solution root and its folders so the
   * structure shows while leaving projects collapsed (their contents are loaded but hidden until
   * opened).
   * @param model The new model, or null to clear.
   */
  private reset(model: ProjectModel | null): void {
    this.current.set(model);
    this.itemsByProject.set(new Map<string, ProjectItems>());
    const loading: boolean = model !== null && model.projects.length > 0;
    this.loadingContents.set(loading);
    // Pre-expand the solution folders, but leave the root collapsed until loading finishes so its
    // structure is revealed only once it is ready.
    const expanded: Set<string> = new Set<string>();
    if (model !== null) {
      this.collectFolderKeys(model.tree, '', expanded);
      if (!loading) {
        expanded.add(ROOT_KEY);
      }
    }
    this.expandedKeys.set(expanded);
  }

  /**
   * Eagerly evaluates every project's contents, a bounded number at a time, populating the cache as
   * each completes and clearing the loading state once all are done. Applies nothing once superseded.
   * @param model The model whose projects are loaded.
   * @param generation The load generation this work belongs to.
   * @returns Returns a promise that resolves once loading completes.
   */
  private async loadAllContents(model: ProjectModel, generation: number): Promise<void> {
    const queue: ProjectEntry[] = [...model.projects];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (let next: ProjectEntry | undefined = queue.shift(); next !== undefined; next = queue.shift()) {
        const items: ProjectItems | null = (await this.api?.loadItems(next.path)) ?? null;
        if (generation === this.generation && items !== null) {
          const cache: Map<string, ProjectItems> = new Map<string, ProjectItems>(this.itemsByProject());
          cache.set(items.projectPath, items);
          this.itemsByProject.set(cache);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(LOAD_CONCURRENCY, queue.length) }, (): Promise<void> => worker()),
    );
    if (generation === this.generation) {
      this.loadingContents.set(false);
      // Reveal the structure now that it is ready.
      const expanded: Set<string> = new Set<string>(this.expandedKeys());
      expanded.add(ROOT_KEY);
      this.expandedKeys.set(expanded);
    }
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
   * Collects the keys of every solution folder, so they start expanded.
   * @param nodes The nodes to scan.
   * @param parentKey The key prefix of the nodes' parent.
   * @param keys The set the folder keys are added to.
   */
  private collectFolderKeys(
    nodes: readonly ProjectNode[],
    parentKey: string,
    keys: Set<string>,
  ): void {
    for (const node of nodes) {
      if (node.type === 'folder') {
        const key: string = `${parentKey}/${node.name}`;
        keys.add(key);
        this.collectFolderKeys(node.children, key, keys);
      }
    }
  }

  /**
   * Appends the rows for a run of solution nodes (folders and projects), recursing into the expanded
   * ones.
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
    for (const node of nodes) {
      if (node.type === 'folder') {
        const key: string = `${parentKey}/${node.name}`;
        const expanded: boolean = this.expandedKeys().has(key);
        rows.push(this.row(key, depth, node.name, 'folder', true, expanded, false, null));
        if (expanded) {
          this.appendNodes(node.children, depth + 1, key, rows);
        }
      } else {
        const key: string = `project:${node.path}`;
        const expanded: boolean = this.expandedKeys().has(key);
        rows.push(this.row(key, depth, node.name, 'project', true, expanded, false, node.path));
        const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
        if (expanded && items !== undefined) {
          this.appendItems(items.tree, depth + 1, key, rows);
        }
      }
    }
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
