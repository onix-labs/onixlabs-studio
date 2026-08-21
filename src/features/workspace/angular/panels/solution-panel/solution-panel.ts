import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ProjectModel } from '@shared/api/project-system';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { SolutionModel, SolutionRow } from '@features/workspace/angular/project/solution-model';
import { GitChangeStatus, statusLetter } from '@shared/angular/services/repository/repository-data';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { ExplorerToolbar } from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import { HighlightedText } from '@shared/angular/components/highlighted-text/highlighted-text';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Shell } from '@shared/angular/services/shell/shell';
import {
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';

/**
 * Identifies the context-menu and toolbar actions the panel offers.
 */
const ACTION_OPEN: string = 'open';
const ACTION_EDIT_PROJECT: string = 'edit-project';
const ACTION_COPY_PATH: string = 'copy-path';
const ACTION_COPY_RELATIVE: string = 'copy-relative-path';
const ACTION_REVEAL: string = 'reveal';
const ACTION_FOLLOW: string = 'follow-active';
const ACTION_GIT_STATUS: string = 'git-status';
const ACTION_RELOAD: string = 'reload';

/**
 * The label for revealing a path in the operating system's file manager, named for the platform so it
 * matches what the user's own menus call it.
 */
const REVEAL_LABEL: string = navigator.userAgent.includes('Mac')
  ? 'Reveal in Finder'
  : navigator.userAgent.includes('Windows')
    ? 'Show in File Explorer'
    : 'Show in File Manager';

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
   * Holds the structured logger for solution explorer actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the shell service used to reveal a path in the operating system's file manager.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Gets the toolbar's overflow items: the options that belong to the panel as a whole rather than to
   * any one row, which is what the row context menu is for.
   */
  public readonly moreItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => [
    {
      id: ACTION_FOLLOW,
      label: 'Sync with Active Document',
      icon: Icon.LINK,
      active: this.solution.followsActiveDocument(),
    },
    {
      id: ACTION_GIT_STATUS,
      label: 'Show Git Status',
      icon: Icon.SOURCE_CONTROL,
      active: this.solution.showsGitStatus(),
    },
    { id: ACTION_RELOAD, label: 'Reload Solution', icon: Icon.REFRESH },
  ]);

  /**
   * Builds a row's context-menu items.
   *
   * Bound as a value rather than a method, because the tree calls it as its item factory when a menu
   * opens — `this` must stay this component. Items that do not apply to the row are omitted rather
   * than disabled: unlike a fixed toolbar menu, a context menu is summoned onto a specific row, so
   * there is no expectation of a stable shape to preserve.
   */
  public readonly contextMenuFor: (treeRow: TreeRow) => readonly MenuItem[] = (
    treeRow: TreeRow,
  ): readonly MenuItem[] => {
    const row: SolutionRow = this.rowOf(treeRow);
    const path: string | null = this.pathFor(row);
    const items: MenuItem[] = [];

    if (row.kind === 'file') {
      items.push({ id: ACTION_OPEN, label: 'Open', icon: Icon.FILE });
    }
    if (row.kind === 'project') {
      items.push({ id: ACTION_EDIT_PROJECT, label: 'Edit Project File', icon: Icon.PROJECT });
    }
    if (path !== null) {
      items.push(
        { id: ACTION_COPY_PATH, label: 'Copy Path', icon: Icon.COPY },
        { id: ACTION_COPY_RELATIVE, label: 'Copy Relative Path', icon: Icon.COPY },
        { id: ACTION_REVEAL, label: REVEAL_LABEL, icon: Icon.DIRECTORY },
      );
    }
    return items;
  };

  /**
   * Resolves the path a row's commands act on.
   *
   * The workspace root row carries no path of its own — it is synthesised to head the tree rather
   * than read from the project model — but it plainly stands for the root directory, and offering
   * nothing on the one row every solution has reads as a broken menu. Solution folders are the
   * opposite case and genuinely resolve to nothing: they are groupings inside the `.sln` with no
   * directory behind them, so a path command would have to invent one.
   * @param row The row to resolve.
   * @returns Returns the path the row's commands act on, or null when it stands for nothing on disk.
   */
  private pathFor(row: SolutionRow): string | null {
    if (row.path !== null) {
      return row.path;
    }
    return row.kind === 'solution' ? (this.model()?.root ?? null) : null;
  }

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
   * Gets the key of the selected row, or null when nothing is selected.
   */
  protected readonly selectedKey: Signal<string | null> = this.solution.selectedKey;

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
    this.log.info('workspace.solution', 'Expand all requested');
    this.solution.expandAll();
  }

  /**
   * Collapses every node in the tree, keeping the solution root expanded.
   */
  protected collapseAll(): void {
    this.log.info('workspace.solution', 'Collapse all requested');
    this.solution.collapseAll();
  }

  /**
   * Gets the git change status of a row that maps to a file, or null when it is unchanged, has no
   * path (a logical folder), or the badges are switched off.
   * @param path The row's path, or null.
   * @returns Returns the change status, or null.
   */
  protected statusFor(path: string | null): GitChangeStatus | null {
    if (path === null || !this.solution.showsGitStatus()) {
      return null;
    }
    return this.git.statusFor(path);
  }

  /**
   * Runs a toolbar overflow action.
   * @param id The chosen action.
   */
  public onMoreAction(id: string): void {
    this.log.info('workspace.solution', 'Toolbar action', id);
    switch (id) {
      case ACTION_FOLLOW:
        this.solution.toggleFollowActiveDocument();
        return;
      case ACTION_GIT_STATUS:
        this.solution.toggleGitStatus();
        return;
      case ACTION_RELOAD:
        this.solution.refreshFromDisk();
        return;
      default:
        return;
    }
  }

  /**
   * Runs a row's context-menu action.
   * @param selection The chosen item and the row it was chosen for.
   */
  public onContextAction(selection: TreeMenuSelection): void {
    const row: SolutionRow = this.rowOf(selection.row);
    const path: string | null = this.pathFor(row);
    if (path === null) {
      return;
    }
    this.log.info('workspace.solution', 'Context action', selection.itemId, path);

    switch (selection.itemId) {
      case ACTION_OPEN:
      case ACTION_EDIT_PROJECT:
        this.solution.select(row.key);
        void this.fileOpener.openPath(path);
        return;
      case ACTION_COPY_PATH:
        void navigator.clipboard.writeText(path).catch((): void => undefined);
        return;
      case ACTION_COPY_RELATIVE:
        void navigator.clipboard.writeText(this.relativePath(path)).catch((): void => undefined);
        return;
      case ACTION_REVEAL:
        void this.shell.revealPath(path);
        return;
      default:
        return;
    }
  }

  /**
   * Expresses a path relative to the solution root, falling back to the absolute path when it lies
   * outside (a linked file, which project systems do allow).
   * @param path The absolute path.
   * @returns Returns the relative path, or the absolute path when it is not beneath the root.
   */
  private relativePath(path: string): string {
    const root: string | undefined = this.model()?.root;
    if (root === undefined || !path.startsWith(root)) {
      return path;
    }
    return path.slice(root.length).replace(/^[/\\]+/, '');
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
        // A folder reads as a dashed folder while any project beneath it is still loading, resolving to
        // a plain (or open) folder once loaded.
        return row.loading ? Icon.FOLDER_LOADING : row.expanded ? Icon.FOLDER_OPEN : Icon.DIRECTORY;
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
      this.log.debug('workspace.solution', `Toggle ${row.kind} row`, row.key);
      this.solution.toggle(row);
    } else if (row.path !== null) {
      this.log.info('workspace.solution', 'Open file from solution', row.path);
      this.solution.select(row.key);
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
