import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { GitChangeStatus, statusLetter } from '@shared/angular/services/repository/repository-data';
import {
  Workspace,
  WorkspaceTreeNode,
  WorkspaceTreeRow,
} from '@shared/angular/services/workspace/workspace';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { Icon } from '@shared/angular/icons/icon';
import { ExplorerToolbar } from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import { HighlightedText } from '@shared/angular/components/highlighted-text/highlighted-text';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';

/**
 * Renders the workspace directory tree as the body of the File Explorer dock panel, through the shared
 * {@link TreeView}. The dock chrome supplies the panel's title bar, so this component maps the
 * {@link Workspace}'s lazy tree into tree rows, projects each row's icon/name/git decoration, and
 * delegates clicks back to the workspace (toggling directories, opening files).
 */
@Component({
  selector: 'app-tree-panel',
  imports: [AppIcon, TreeView, ExplorerToolbar, HighlightedText],
  templateUrl: './tree-panel.html',
  styleUrl: './tree-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreePanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the workspace service backing the tree.
   */
  public readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the workspace git status the rows are decorated from.
   */
  private readonly git: WorkspaceGit = inject(WorkspaceGit);

  /**
   * Maps a change status to its badge letter, exposed for the template.
   */
  protected readonly statusLetter: (status: GitChangeStatus) => string = statusLetter;

  /**
   * Holds the opener used to open a file into the right editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Gets the workspace's visible rows mapped to tree rows for the shared {@link TreeView}.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] =>
    this.workspace.rows().map(
      (row: WorkspaceTreeRow): TreeRow => ({
        id: row.node.path,
        depth: row.depth,
        expandable: row.node.type === 'directory',
        expanded: row.expanded,
        data: row.node,
      }),
    ),
  );

  /**
   * Gets the active search query, bound to the toolbar's search box.
   */
  protected readonly query: Signal<string> = this.workspace.query;

  /**
   * Unwraps a tree row's workspace node payload.
   * @param row The tree row.
   * @returns Returns the workspace node.
   */
  protected nodeOf(row: TreeRow): WorkspaceTreeNode {
    return row.data as WorkspaceTreeNode;
  }

  /**
   * Updates the search query from the toolbar's search box.
   * @param value The new search query.
   */
  protected onSearch(value: string): void {
    this.workspace.setQuery(value);
  }

  /**
   * Expands the tree according to the workspace's Expand All setting.
   */
  protected expandAll(): void {
    void this.workspace.expandAll();
  }

  /**
   * Collapses every directory in the tree.
   */
  protected collapseAll(): void {
    this.workspace.collapseAll();
  }

  /**
   * Gets the git change status of a file row, or null when it is unchanged.
   * @param path The node's absolute path.
   * @returns Returns the change status, or null.
   */
  protected statusFor(path: string): GitChangeStatus | null {
    return this.git.statusFor(path);
  }

  /**
   * Gets a value indicating whether a directory row contains a change at any depth.
   * @param path The node's absolute path.
   * @returns Returns true when the directory has descendant changes.
   */
  protected folderChanged(path: string): boolean {
    return this.git.hasChanges(path);
  }

  /**
   * Handles a click on a tree row: selects the entry, toggles directories, and opens files into the
   * right editor tab (reusing an existing tab when the file is already open).
   * @param row The tree row that was clicked.
   */
  public onRowClick(row: TreeRow): void {
    const node: WorkspaceTreeNode = this.nodeOf(row);
    this.workspace.select(node.path);
    if (node.type === 'directory') {
      void this.workspace.toggleDirectory(node.path);
    } else {
      void this.fileOpener.openPath(node.path);
    }
  }

  /**
   * Resolves the icon for a node, by directory state or file extension.
   * @param node The node to resolve an icon for.
   * @returns Returns the node's icon.
   */
  public iconFor(node: WorkspaceTreeNode): Icon {
    if (node.type === 'directory') {
      return node.expanded ? Icon.FOLDER_OPEN : Icon.DIRECTORY;
    }
    const extension: string = this.extensionOf(node.name);
    switch (extension) {
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
      case 'scss':
      case 'css':
        return Icon.FILE_STYLESHEET;
      case 'html':
        return Icon.FILE_HTML;
      default:
        return node.name.startsWith('.') ? Icon.FILE_HIDDEN : Icon.FILE;
    }
  }

  /**
   * Extracts a file's lowercased extension, without the leading dot.
   * @param name The file name.
   * @returns Returns the extension, or an empty string when there is none.
   */
  private extensionOf(name: string): string {
    const dot: number = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  }
}
