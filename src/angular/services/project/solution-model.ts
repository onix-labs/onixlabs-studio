import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ProjectApi } from '../../../shared/studio-api';
import {
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '../../../shared/project-system';
import { Workspace } from '../workspace/workspace';

/**
 * The kind of a Solution Explorer row, which decides its icon and click behaviour.
 */
export type SolutionRowKind = 'folder' | 'project' | 'item-folder' | 'file';

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
   * Holds whether the row's contents are currently loading.
   */
  readonly loading: boolean;

  /**
   * Holds the absolute path the row opens (a project or file), or null when it opens nothing.
   */
  readonly path: string | null;
}

/**
 * Holds and drives this tab's Solution Explorer: the logical project model for the open root (fetched
 * from the main process and refreshed when the root changes), the expansion state of its nodes, and the
 * lazily-loaded contents of each project. Exposes the model's presence (which the directory view uses
 * to show or hide the panel) and a flattened row list the panel renders. Provided per directory tab.
 * Outside Electron the bridge is absent and the model stays null.
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
   * Holds the loaded contents of each project, keyed by project path.
   */
  private readonly itemsByProject: WritableSignal<ReadonlyMap<string, ProjectItems>> = signal<
    ReadonlyMap<string, ProjectItems>
  >(new Map<string, ProjectItems>());

  /**
   * Holds the paths of projects whose contents are currently loading.
   */
  private readonly loadingProjects: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

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
    const rows: SolutionRow[] = [];
    this.appendNodes(model.tree, 0, '', rows);
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
   * Toggles a row's expansion, loading a project's contents the first time it is expanded.
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
        void this.ensureItems(row.path);
      }
    }
    this.expandedKeys.set(next);
  }

  /**
   * Loads the model for a root, clearing it (and all tree state) when there is no root or bridge. A
   * stale response (the root changed again while the request was in flight) is discarded.
   * @param root The workspace root, or null when none is open.
   * @returns Returns a promise that resolves once the model has been updated.
   */
  private async refresh(root: string | null): Promise<void> {
    if (this.api === undefined || root === null) {
      this.reset(null);
      return;
    }
    const model: ProjectModel | null = await this.api.loadModel(root);
    if ((this.workspace.root()?.path ?? null) === root) {
      this.reset(model);
    }
  }

  /**
   * Replaces the model and resets the tree state, expanding the solution folders so the structure shows
   * while leaving projects collapsed until opened.
   * @param model The new model, or null to clear.
   */
  private reset(model: ProjectModel | null): void {
    this.current.set(model);
    this.itemsByProject.set(new Map<string, ProjectItems>());
    this.loadingProjects.set(new Set<string>());
    const expanded: Set<string> = new Set<string>();
    if (model !== null) {
      this.collectFolderKeys(model.tree, '', expanded);
    }
    this.expandedKeys.set(expanded);
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
   * Loads a project's contents once, tracking the loading state while in flight.
   * @param projectPath The absolute project path.
   * @returns Returns a promise that resolves once loading completes.
   */
  private async ensureItems(projectPath: string): Promise<void> {
    if (
      this.api === undefined ||
      this.itemsByProject().has(projectPath) ||
      this.loadingProjects().has(projectPath)
    ) {
      return;
    }
    this.setLoading(projectPath, true);
    const items: ProjectItems | null = await this.api.loadItems(projectPath);
    this.setLoading(projectPath, false);
    if (items !== null) {
      const next: Map<string, ProjectItems> = new Map<string, ProjectItems>(this.itemsByProject());
      next.set(projectPath, items);
      this.itemsByProject.set(next);
    }
  }

  /**
   * Sets or clears a project's loading state.
   * @param projectPath The absolute project path.
   * @param loading Whether the project is loading.
   */
  private setLoading(projectPath: string, loading: boolean): void {
    const next: Set<string> = new Set<string>(this.loadingProjects());
    if (loading) {
      next.add(projectPath);
    } else {
      next.delete(projectPath);
    }
    this.loadingProjects.set(next);
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
        const loading: boolean = this.loadingProjects().has(node.path);
        rows.push(this.row(key, depth, node.name, 'project', true, expanded, loading, node.path));
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
   * @param loading Whether the row's contents are loading.
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
