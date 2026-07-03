import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ProjectModel } from '@shared/project-system';
import { DockPanel } from '@shared/angular/services/dock/dock-panel';
import { FileOpener } from '../../../services/file-opener/file-opener';
import { SolutionModel, SolutionRow } from '../../../services/project/solution-model';
import { GitChangeStatus, statusLetter } from '@shared/angular/services/repository/repository-data';
import { WorkspaceGit } from '../../../services/workspace-git/workspace-git';
import { Icon } from '@shared/angular/icons/icon';
import { ExplorerToolbar } from '../../shared/explorer-toolbar/explorer-toolbar';
import { HighlightedText } from '../../shared/highlighted-text/highlighted-text';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TreeRow, TreeView } from '../../shared/tree-view/tree-view';

/**
 * Renders the logical solution model (solution folders, projects, and each project's files) as the body
 * of the Solution Explorer dock panel, through the shared {@link TreeView} — distinct from the File
 * Explorer's filesystem tree. The model and its expansion/loading state come from the tab-scoped
 * {@link SolutionModel}; a project's files load on first expansion. Clicking an expandable row toggles
 * it; clicking a file opens it.
 */
@Component({
  selector: 'app-solution-panel',
  imports: [AppIcon, TreeView, ExplorerToolbar, HighlightedText],
  templateUrl: './solution-panel.html',
  styleUrl: './solution-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolutionPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet; unused here because
   * the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the tab-scoped solution model the panel renders.
   */
  private readonly solution: SolutionModel = inject(SolutionModel);

  /**
   * Holds the opener used to open a file into an editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the workspace git status the rows are decorated from.
   */
  private readonly git: WorkspaceGit = inject(WorkspaceGit);

  /**
   * Maps a change status to its badge letter, exposed for the template.
   */
  protected readonly statusLetter: (status: GitChangeStatus) => string = statusLetter;

  /**
   * Gets the current solution model, or null when there is none (the empty state).
   */
  public readonly model: Signal<ProjectModel | null> = this.solution.model;

  /**
   * Gets the active search query, bound to the toolbar's search box.
   */
  protected readonly query: Signal<string> = this.solution.query;

  /**
   * Gets the solution's visible rows mapped to tree rows for the shared {@link TreeView}.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] =>
    this.solution.rows().map(
      (row: SolutionRow): TreeRow => ({
        id: row.key,
        depth: row.depth,
        expandable: row.expandable,
        expanded: row.expanded,
        data: row,
      }),
    ),
  );

  /**
   * Unwraps a tree row's solution-row payload.
   * @param row The tree row.
   * @returns Returns the solution row.
   */
  protected rowOf(row: TreeRow): SolutionRow {
    return row.data as SolutionRow;
  }

  /**
   * Updates the search query from the toolbar's search box.
   * @param value The new search query.
   */
  protected onSearch(value: string): void {
    this.solution.setQuery(value);
  }

  /**
   * Expands every node in the tree.
   */
  protected expandAll(): void {
    this.solution.expandAll();
  }

  /**
   * Collapses every node in the tree, keeping the solution root expanded.
   */
  protected collapseAll(): void {
    this.solution.collapseAll();
  }

  /**
   * Gets the git change status of a row that maps to a file, or null when it is unchanged or has no
   * path (a logical folder).
   * @param path The row's path, or null.
   * @returns Returns the change status, or null.
   */
  protected statusFor(path: string | null): GitChangeStatus | null {
    return path === null ? null : this.git.statusFor(path);
  }

  /**
   * Resolves a row's icon by its kind and expansion.
   * @param row The row to resolve an icon for.
   * @returns Returns the row's icon.
   */
  public iconFor(row: SolutionRow): Icon {
    switch (row.kind) {
      case 'solution':
        return Icon.SOLUTION_EXPLORER;
      case 'project':
        return Icon.PROJECT;
      case 'folder':
      case 'item-folder':
        return row.expanded ? Icon.FOLDER_OPEN : Icon.DIRECTORY;
      default:
        return this.fileIconFor(row.label);
    }
  }

  /**
   * Handles a click on a row: toggles an expandable row, or opens a file. A still-loading project is
   * inert until its contents arrive.
   * @param treeRow The tree row that was clicked.
   */
  public onRowClick(treeRow: TreeRow): void {
    const row: SolutionRow = this.rowOf(treeRow);
    if (row.loading) {
      return;
    }
    if (row.expandable) {
      this.solution.toggle(row);
    } else if (row.path !== null) {
      void this.fileOpener.openPath(row.path);
    }
  }

  /**
   * Resolves a file's icon from its extension.
   * @param name The file name.
   * @returns Returns the file's icon.
   */
  private fileIconFor(name: string): Icon {
    const dot: number = name.lastIndexOf('.');
    switch (dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()) {
      case 'ts':
        return Icon.FILE_TYPESCRIPT;
      case 'js':
      case 'mjs':
      case 'cjs':
        return Icon.FILE_JAVASCRIPT;
      case 'json':
        return Icon.FILE_JSON;
      case 'md':
        return Icon.FILE_MARKDOWN;
      case 'xml':
      case 'csproj':
      case 'props':
      case 'targets':
        return Icon.FILE_JSON;
      default:
        return Icon.FILE;
    }
  }
}
