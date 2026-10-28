import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import {
  Workspace,
  WorkspaceTreeNode,
  WorkspaceTreeRow,
} from '@shared/angular/services/workspace/workspace';
import { FileOperationResult } from '@shared/api/workspace-channels';
import {
  isChangedState,
  scmRowFields,
  WorkspaceGit,
} from '@features/workspace/angular/workspace-git/workspace-git';
import {
  ExplorerVcsMenu,
  ExplorerVcsTarget,
} from '@features/workspace/angular/workspace-git/explorer-vcs-menu';
import { Log } from '@shared/angular/services/log/log';
import { ExplorerFilterKind } from '@shared/angular/services/explorer-filter/explorer-filter';
import { WorkspaceProblems } from '@features/workspace/angular/workspace-problems/workspace-problems';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Shell } from '@shared/angular/services/shell/shell';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';
import { Icon } from '@shared/angular/icons/icon';
import { fileIconFor } from '@shared/angular/icons/file-icon';
import {
  ExplorerFilterState,
  ExplorerToolbar,
} from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import { HighlightedText } from '@shared/angular/components/highlighted-text/highlighted-text';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { RowEditSelection } from '@shared/angular/components/row-edit-field/row-edit-field';
import {
  TreeEdit,
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';
import {
  TreeSelectGesture,
  TreeSelection,
} from '@shared/angular/components/tree-view/tree-selection';
import { Button } from '@shared/angular/components/forms/button/button';
import { PanelStatus } from '@shared/angular/components/panel-status/panel-status';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';

/**
 * Identifies the row context-menu actions the panel offers.
 */
const ACTION_OPEN: string = 'open';
const ACTION_NEW_FILE: string = 'new-file';
const ACTION_NEW_FOLDER: string = 'new-folder';
const ACTION_COPY_PATH: string = 'copy-path';
const ACTION_COPY_RELATIVE: string = 'copy-relative-path';
const ACTION_REVEAL: string = 'reveal';
const ACTION_RENAME: string = 'rename';
const ACTION_DELETE: string = 'delete';

/**
 * Identifies the toolbar "…" menu's commands: the options submenu and its two switches, and the
 * commands that act on the whole tree or its root.
 */
const ACTION_OPTIONS: string = 'options';
const ACTION_FOLLOW: string = 'follow-active';
const ACTION_GIT_STATUS: string = 'git-status';
const ACTION_OPEN_ROOT: string = 'open-root';
const ACTION_COPY_ROOT: string = 'copy-workspace-path';
const ACTION_REFRESH: string = 'refresh';

/**
 * Identifies the placeholder row a create is named in. Never a path — a NUL cannot occur in one — so it
 * cannot collide with an entry in the tree.
 */
const PLACEHOLDER_ID: string = '\u0000new-entry';

/**
 * Which naming operation a row is being edited for.
 */
export type NameEditKind = 'new-file' | 'new-folder' | 'rename';

/**
 * A naming operation in progress: a row of the tree being named in place.
 */
export interface NameEdit {
  /**
   * Gets which operation the name is for.
   */
  readonly kind: NameEditKind;

  /**
   * Gets the directory a create happens in, or the absolute path of the entry a rename renames.
   */
  readonly target: string;

  /**
   * Gets the id of the row being edited: the entry's own row for a rename, the placeholder for a create.
   */
  readonly rowId: string;

  /**
   * Gets the name the edit starts from: the entry's name for a rename, empty for a create.
   */
  readonly initial: string;

  /**
   * Gets what the field selects when it opens: a file's stem, or the whole of a folder's name (a dot
   * in a folder's name does not start an extension).
   */
  readonly selection: RowEditSelection;
}

/**
 * Renders the workspace directory tree as the body of the File Explorer dock panel, through the shared
 * {@link TreeView}. The dock chrome supplies the panel's title bar, so this component maps the
 * {@link Workspace}'s lazy tree into tree rows, projects each row's icon/name/git decoration, and
 * delegates clicks back to the workspace (toggling directories, opening files).
 *
 * Each row also carries the commands a file tree is expected to offer — opening, the two path copies,
 * revealing, and the three writes (new, rename, delete). The writes run through {@link Workspace},
 * which confines them to the workspace root in the main process; a delete goes to the operating
 * system's trash, and the confirmation says so. The three naming writes are typed into the tree itself:
 * a rename turns the entry's row into a field, and a create opens a placeholder row, first among the
 * target directory's children, that becomes the new entry once it is named.
 */
@Component({
  selector: 'app-tree-panel',
  imports: [
    Button,
    ButtonRow,
    AppIcon,
    TreeView,
    ExplorerToolbar,
    HighlightedText,
    Modal,
    ModalContent,
    PanelStatus,
  ],
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
   * Holds where the workspace's problems are, for the error squiggles and the filter (#1182 follow-up).
   */
  private readonly problems: WorkspaceProblems = inject(WorkspaceProblems);

  /**
   * Holds the opener used to open a file into the right editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the version-control commands a row offers, shared with the Solution Explorer (#1041).
   */
  private readonly vcsMenu: ExplorerVcsMenu = inject(ExplorerVcsMenu);

  /**
   * Holds the structured logger for workspace tree actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the shell service used to reveal a path in the operating system's file manager.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the notification service used to report a write that did not go as its confirmation said.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the naming operation in progress, or null when no row is being named.
   */
  public readonly editing: WritableSignal<NameEdit | null> = signal<NameEdit | null>(null);

  /**
   * Holds the entries awaiting a delete confirmation — one, or a selection — or null when none is
   * pending.
   */
  public readonly deleteTargets: WritableSignal<readonly WorkspaceTreeNode[] | null> = signal<
    readonly WorkspaceTreeNode[] | null
  >(null);

  /**
   * Holds which rows are selected (#1048). The workspace's selected path is the row last acted on, the
   * one single-row surfaces follow; this holds the rest of a multi-row selection around it.
   */
  protected readonly selection: TreeSelection = new TreeSelection();

  /**
   * Keeps the selection in step when the selected path is moved from outside — following the focused
   * document, an agent revealing a file, a click on empty space — by making that row the selection.
   */
  private readonly followSelectedPath: unknown = effect((): void => {
    const path: string | null = this.workspace.selectedPath();
    untracked((): void => {
      if (path !== this.selection.focused()) {
        this.selection.replace(path);
      }
    });
  });

  /**
   * Gets the workspace's visible rows mapped to tree rows for the shared {@link TreeView}, with a create's
   * placeholder row spliced in while one is being named.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const rows: TreeRow[] = this.shownRows().map((row: WorkspaceTreeRow): TreeRow => ({
      id: row.node.path,
      depth: row.depth,
      expandable: row.node.type === 'directory',
      expanded: row.expanded,
      // How version control sees the path, in colour (#860) — unless the colours are switched off.
      ...(this.workspace.showsGitStatus() ? scmRowFields(this.git.stateFor(row.node.path)) : {}),
      // An error in the file, or beneath the folder, squiggles its name as an editor would.
      ...(this.problems.has(row.node.path, 'error') ? { squiggle: true } : {}),
      data: row.node,
    }));
    const edit: NameEdit | null = this.editing();
    if (edit === null || edit.kind === 'rename') {
      return rows;
    }
    return this.withPlaceholder(rows, edit);
  });

  /**
   * Gets the kinds the tree is narrowed to that can narrow it here (#1182 follow-up): those ticked,
   * less Show Differences outside a repository, where nothing is changed.
   */
  private readonly filterKinds: Signal<ReadonlySet<ExplorerFilterKind>> = computed(
    (): ReadonlySet<ExplorerFilterKind> => {
      const selected: ReadonlySet<ExplorerFilterKind> = this.workspace.filter.selected();
      if (!selected.has('changes') || this.git.isRepository()) {
        return selected;
      }
      const usable: Set<ExplorerFilterKind> = new Set<ExplorerFilterKind>(selected);
      usable.delete('changes');
      return usable;
    },
  );

  /**
   * Gets whether the tree is narrowed at all: something it can be narrowed to is ticked.
   */
  protected readonly filtering: Signal<boolean> = computed(
    (): boolean => this.filterKinds().size > 0,
  );

  /**
   * Gets the tool strip's filter: what is ticked, Show Differences not offered at all outside a
   * repository, and inert in one with nothing changed.
   */
  protected readonly filterState: Signal<ExplorerFilterState> = computed(
    (): ExplorerFilterState => ({
      selected: this.workspace.filter.selected(),
      unavailable:
        this.git.isRepository() && !this.git.hasChanges() ? { changes: 'no changes' } : {},
      ...(this.git.isRepository() ? {} : { hidden: ['changes'] }),
    }),
  );

  /**
   * Unticks Show Differences once nothing is changed — after a commit, say — so the tree goes back to
   * showing everything else rather than standing empty (#1053). Waits for the repository's status to
   * be read, so a repository that has only just opened is not taken for a clean one.
   */
  private readonly leaveWhenClean: unknown = effect((): void => {
    if (
      this.workspace.filter.selected().has('changes') &&
      this.git.isRepository() &&
      this.git.statusRead() &&
      !this.git.hasChanges()
    ) {
      untracked((): void => this.workspace.filter.clear('changes'));
    }
  });

  /**
   * Gets the workspace's rows the tree shows: all of them, or — narrowed — the files matching any kind
   * ticked and the folders on the way to them.
   */
  private readonly shownRows: Signal<readonly WorkspaceTreeRow[]> = computed(
    (): readonly WorkspaceTreeRow[] => {
      const rows: readonly WorkspaceTreeRow[] = this.workspace.rows();
      const kinds: ReadonlySet<ExplorerFilterKind> = this.filterKinds();
      return kinds.size === 0
        ? rows
        : rows.filter((row: WorkspaceTreeRow): boolean => this.matches(row.node.path, kinds));
    },
  );

  /**
   * Holds the folders the filter opened to lead to what it shows, so clearing it closes exactly those
   * and leaves the tree as it was — and so a folder the user closes is not opened again behind their
   * back.
   */
  private readonly openedForFilter: Set<string> = new Set<string>();

  /**
   * Opens the folders that lead to what the filter shows while it narrows the tree — level by level,
   * as each opened folder's entries arrive — and closes them again when it is cleared.
   */
  private readonly followFilter: unknown = effect((): void => {
    const kinds: ReadonlySet<ExplorerFilterKind> = this.filterKinds();
    const rows: readonly WorkspaceTreeRow[] = this.workspace.rows();
    untracked((): void => {
      if (kinds.size === 0) {
        for (const path of this.openedForFilter) {
          const row: WorkspaceTreeRow | undefined = rows.find(
            (candidate: WorkspaceTreeRow): boolean => candidate.node.path === path,
          );
          if (row?.expanded === true) {
            void this.workspace.toggleDirectory(path);
          }
        }
        this.openedForFilter.clear();
        return;
      }
      for (const row of rows) {
        const path: string = row.node.path;
        if (
          row.node.type === 'directory' &&
          !row.expanded &&
          !this.openedForFilter.has(path) &&
          this.matches(path, kinds)
        ) {
          this.openedForFilter.add(path);
          void this.workspace.toggleDirectory(path);
        }
      }
    });
  });

  /**
   * Determines whether a path matches any kind the tree is narrowed to: a file changed, or with
   * problems of a ticked severity — or a folder leading to one.
   * @param path The file's or folder's absolute path.
   * @param kinds The kinds.
   * @returns Returns true when it does.
   */
  private matches(path: string, kinds: ReadonlySet<ExplorerFilterKind>): boolean {
    for (const kind of kinds) {
      if (
        kind === 'changes' ? isChangedState(this.git.stateFor(path)) : this.problems.has(path, kind)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Gets where the selection is, for the status strip: the folder holding the selected row, from the
   * workspace folder down (`studio/src/app`) — or the workspace folder alone when nothing is selected
   * or the row sits at its top.
   */
  protected readonly statusLocation: Signal<string> = computed((): string => {
    const root: string = this.workspace.root()?.name ?? '';
    const selected: string | null = this.workspace.selectedPath();
    if (selected === null) {
      return root;
    }
    const relative: string = this.relativePath(selected);
    const cut: number = Math.max(relative.lastIndexOf('/'), relative.lastIndexOf('\\'));
    return cut < 0 ? root : `${root}/${relative.slice(0, cut).replaceAll('\\', '/')}`;
  });

  /**
   * Gets what is selected, for the status strip: the row's name and icon, how many rows when several
   * are, or null when nothing is.
   */
  protected readonly statusSelection: Signal<{
    readonly text: string;
    readonly icon: Icon;
  } | null> = computed((): { readonly text: string; readonly icon: Icon } | null => {
    const count: number = this.selection.ids().length;
    if (count > 1) {
      return { text: `${count} selections`, icon: Icon.LIST_ALL };
    }
    const selected: string | null = this.workspace.selectedPath();
    if (selected === null) {
      return null;
    }
    const node: WorkspaceTreeNode | undefined = this.workspace
      .rows()
      .find((row: WorkspaceTreeRow): boolean => row.node.path === selected)?.node;
    const name: string = node?.name ?? selected.split(/[\\/]/).pop() ?? selected;
    return {
      text: name,
      icon: node?.type === 'directory' ? Icon.DIRECTORY : fileIconFor(name),
    };
  });

  /**
   * Gets the active search query, bound to the toolbar's search box.
   */
  protected readonly query: Signal<string> = this.workspace.query;

  /**
   * Gets the toolbar's "…" menu: the commands that act on the tree as a whole, or on the workspace
   * root, which has no row of its own to carry them.
   */
  protected readonly moreItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => [
    {
      id: ACTION_OPTIONS,
      label: 'Options',
      icon: Icon.OPTIONS,
      children: [
        {
          id: ACTION_FOLLOW,
          label: 'Follow Focused Document',
          checked: this.workspace.followsActiveDocument(),
        },
        {
          id: ACTION_GIT_STATUS,
          label: 'Show Git Status',
          checked: this.workspace.showsGitStatus(),
        },
      ],
    },
    { id: 'tree-more.sep-create', label: '', separator: true },
    { id: ACTION_NEW_FILE, label: 'New File', icon: Icon.FILE },
    { id: ACTION_NEW_FOLDER, label: 'New Folder', icon: Icon.DIRECTORY },
    { id: 'tree-more.sep-root', label: '', separator: true },
    { id: ACTION_OPEN_ROOT, label: OPEN_IN_FILE_SYSTEM_LABEL, icon: Icon.DIRECTORY },
    { id: ACTION_COPY_ROOT, label: 'Copy Workspace Path', icon: Icon.COPY },
    { id: ACTION_REFRESH, label: 'Refresh', icon: Icon.REFRESH },
  ]);

  /**
   * Runs a command chosen from the toolbar's "…" menu.
   * @param itemId The chosen item.
   */
  protected onMoreAction(itemId: string): void {
    const root: string | undefined = this.workspace.root()?.path;
    switch (itemId) {
      case ACTION_FOLLOW:
        this.workspace.toggleFollowActiveDocument();
        return;
      case ACTION_GIT_STATUS:
        this.workspace.toggleGitStatus();
        return;
      case ACTION_NEW_FILE:
      case ACTION_NEW_FOLDER:
        // The root has no row, so its creates are reached here; the tree opens the placeholder
        // first among the root's own entries.
        if (root !== undefined) {
          void this.beginCreate(itemId === ACTION_NEW_FILE ? 'new-file' : 'new-folder', root);
        }
        return;
      case ACTION_OPEN_ROOT:
        // The folder's own contents, not the folder selected inside its parent — which for a root
        // would show it sitting in whatever directory happens to contain it.
        if (root !== undefined) {
          void this.shell.openPath(root);
        }
        return;
      case ACTION_COPY_ROOT:
        if (root !== undefined) {
          void navigator.clipboard.writeText(root).catch((): void => undefined);
        }
        return;
      case ACTION_REFRESH:
        this.log.info('workspace.tree', 'Refresh requested');
        void this.workspace.refreshFromDisk();
        void this.git.refresh();
        return;
      default:
        return;
    }
  }

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
    this.log.info('workspace.tree', 'Expand all requested');
    void this.workspace.expandAll();
  }

  /**
   * Collapses every directory in the tree.
   */
  protected collapseAll(): void {
    this.log.info('workspace.tree', 'Collapse all requested');
    this.workspace.collapseAll();
  }

  /**
   * Handles a plain click on a tree row: toggles a directory. Selecting is {@link onRowSelect}'s, and a
   * file is only selected — clicking around the tree to look opens nothing (#1047).
   * @param row The tree row that was clicked.
   */
  public onRowClick(row: TreeRow): void {
    const node: WorkspaceTreeNode = this.nodeOf(row);
    if (node.type === 'directory') {
      this.log.debug('workspace.tree', 'Toggle directory', node.path);
      void this.workspace.toggleDirectory(node.path);
    }
  }

  /**
   * Applies a selection gesture — a click, ⌘- or Shift-click, an arrow key — and makes the row it
   * landed on the workspace's selected path (#1048).
   * @param gesture The gesture.
   */
  public onRowSelect(gesture: TreeSelectGesture): void {
    this.selection.apply(gesture.row.id, gesture.mode, this.visibleOrder());
    this.syncSelectedPath();
  }

  /**
   * Selects every visible row, for ⌘A in the tree (#1048).
   */
  public onSelectAll(): void {
    this.selection.selectAll(this.visibleOrder());
    this.syncSelectedPath();
  }

  /**
   * Makes the row last acted on the workspace's selected path, or clears it.
   */
  private syncSelectedPath(): void {
    const focused: string | null = this.selection.focused();
    if (focused === null) {
      this.workspace.clearSelection();
    } else {
      this.workspace.select(focused);
    }
  }

  /**
   * Gets every visible row's id, in order — the order a selection is kept and acted on in.
   * @returns Returns the ids.
   */
  private visibleOrder(): readonly string[] {
    return this.rows().map((row: TreeRow): string => row.id);
  }

  /**
   * Gets the entries a command chosen on a row acts on: the selection, when the row is part of it,
   * otherwise the row alone.
   * @param row The row the command was chosen on.
   * @returns Returns the entries, in the order the tree shows them.
   */
  private targetsOf(row: TreeRow): readonly WorkspaceTreeNode[] {
    const byPath: ReadonlyMap<string, WorkspaceTreeNode> = new Map<string, WorkspaceTreeNode>(
      this.workspace
        .rows()
        .map((candidate: WorkspaceTreeRow): [string, WorkspaceTreeNode] => [
          candidate.node.path,
          candidate.node,
        ]),
    );
    const targets: readonly WorkspaceTreeNode[] = this.selection
      .targetsFor(row.id, this.visibleOrder())
      .map((id: string): WorkspaceTreeNode | undefined => byPath.get(id))
      .filter(
        (node: WorkspaceTreeNode | undefined): node is WorkspaceTreeNode => node !== undefined,
      );
    return targets.length === 0 ? [this.nodeOf(row)] : targets;
  }

  /**
   * Opens a file row — on a double click, or Enter — into the right editor tab, reusing an existing tab
   * when the file is already open (#1047). A directory opens nothing: its clicks already toggled it.
   * @param row The tree row to open.
   */
  public onRowOpen(row: TreeRow): void {
    const node: WorkspaceTreeNode = this.nodeOf(row);
    if (node.type === 'file') {
      this.log.info('workspace.tree', 'Open file from tree', node.path);
      void this.fileOpener.openPath(node.path);
    }
  }

  /**
   * Builds a row's context-menu items.
   *
   * Bound as a value rather than a method, because the tree calls it as its item factory when a menu
   * opens — `this` must stay this component. Items that do not apply to the row are omitted rather
   * than disabled: a context menu is summoned onto a specific row, so there is no stable shape to
   * preserve, unlike the toolbar's fixed menu.
   *
   * New File and New Folder are offered on both kinds, not only on directories. On a directory they
   * create inside it; on a file they create alongside it, which is both what other editors do and the
   * only way to reach the workspace root — the root is not itself a row, so a tree whose creates only
   * worked on directories could never add a top-level file.
   *
   * Opened on a row of a multi-row selection (#1048), it offers what acts on all of it instead — see
   * {@link selectionItems}.
   */
  public readonly contextMenuFor: (treeRow: TreeRow) => readonly MenuItem[] = (
    treeRow: TreeRow,
  ): readonly MenuItem[] => {
    const targets: readonly WorkspaceTreeNode[] = this.targetsOf(treeRow);
    if (targets.length > 1) {
      return this.selectionItems(targets);
    }
    const node: WorkspaceTreeNode = this.nodeOf(treeRow);
    const items: MenuItem[] = [];

    if (node.type === 'file') {
      items.push({ id: ACTION_OPEN, label: 'Open', icon: Icon.FILE });
    }
    items.push(
      { id: ACTION_NEW_FILE, label: 'New File', icon: Icon.FILE },
      { id: ACTION_NEW_FOLDER, label: 'New Folder', icon: Icon.DIRECTORY },
      // A separator is a rule in its own right rather than a flag on the row below it, so it is only
      // pushed where there is genuinely something to divide.
      { id: 'tree-menu.sep-paths', label: '', separator: true },
      { id: ACTION_COPY_PATH, label: 'Copy Path', icon: Icon.COPY },
      { id: ACTION_COPY_RELATIVE, label: 'Copy Relative Path', icon: Icon.COPY },
      { id: ACTION_REVEAL, label: OPEN_IN_FILE_SYSTEM_LABEL, icon: Icon.DIRECTORY },
      ...this.versionControlItems([node]),
      { id: 'tree-menu.sep-writes', label: '', separator: true },
      { id: ACTION_RENAME, label: 'Rename', icon: Icon.PENCIL },
      { id: ACTION_DELETE, label: 'Delete', icon: Icon.TRASH },
    );
    return items;
  };

  /**
   * Builds the menu for several selected rows (#1048): only what acts on every one of them. Open when
   * they are all files, the two path copies (one path per line), the version-control commands they all
   * take, and Delete. What needs one row of its own — New, Rename, Open in File System — is left out.
   * @param targets The selected entries.
   * @returns Returns the items.
   */
  private selectionItems(targets: readonly WorkspaceTreeNode[]): readonly MenuItem[] {
    const items: MenuItem[] = [];
    if (targets.every((node: WorkspaceTreeNode): boolean => node.type === 'file')) {
      items.push(
        { id: ACTION_OPEN, label: 'Open', icon: Icon.FILE },
        { id: 'tree-menu.sep-paths', label: '', separator: true },
      );
    }
    items.push(
      { id: ACTION_COPY_PATH, label: 'Copy Paths', icon: Icon.COPY },
      { id: ACTION_COPY_RELATIVE, label: 'Copy Relative Paths', icon: Icon.COPY },
      ...this.versionControlItems(targets),
      { id: 'tree-menu.sep-writes', label: '', separator: true },
      { id: ACTION_DELETE, label: 'Delete', icon: Icon.TRASH },
    );
    return items;
  }

  /**
   * Builds the version-control commands for a row or a selection, under a separator, or nothing when
   * none applies.
   * @param nodes The row's node, or the selected nodes.
   * @returns Returns the items.
   */
  private versionControlItems(nodes: readonly WorkspaceTreeNode[]): readonly MenuItem[] {
    const items: readonly MenuItem[] = this.vcsMenu.itemsFor(nodes.map(vcsTargetOf));
    return items.length === 0
      ? []
      : [{ id: 'tree-menu.sep-vcs', label: '', separator: true }, ...items];
  }

  /**
   * Runs the command chosen from a row's context menu — on the row, or on the whole selection when it
   * was opened on a row of one (#1048).
   * @param selection The chosen item and the row it was chosen for.
   */
  public onContextAction(selection: TreeMenuSelection): void {
    const targets: readonly WorkspaceTreeNode[] = this.targetsOf(selection.row);
    if (this.vcsMenu.run(selection.itemId, targets.map(vcsTargetOf))) {
      return;
    }
    if (targets.length > 1) {
      this.runOnSelection(selection.itemId, targets);
      return;
    }
    const node: WorkspaceTreeNode = this.nodeOf(selection.row);
    switch (selection.itemId) {
      case ACTION_OPEN:
        this.workspace.select(node.path);
        void this.fileOpener.openPath(node.path);
        return;
      case ACTION_NEW_FILE:
        void this.beginCreate('new-file', this.directoryFor(node));
        return;
      case ACTION_NEW_FOLDER:
        void this.beginCreate('new-folder', this.directoryFor(node));
        return;
      case ACTION_COPY_PATH:
        void navigator.clipboard.writeText(node.path).catch((): void => undefined);
        return;
      case ACTION_COPY_RELATIVE:
        void navigator.clipboard
          .writeText(this.relativePath(node.path))
          .catch((): void => undefined);
        return;
      case ACTION_REVEAL:
        void this.shell.revealPath(node.path);
        return;
      case ACTION_RENAME:
        this.editing.set({
          kind: 'rename',
          target: node.path,
          rowId: node.path,
          initial: node.name,
          selection: node.type === 'file' ? 'stem' : 'all',
        });
        return;
      case ACTION_DELETE:
        this.deleteTargets.set([node]);
        return;
      default:
        return;
    }
  }

  /**
   * Runs a command chosen for several selected rows (#1048).
   * @param itemId The chosen item.
   * @param targets The selected entries.
   */
  private runOnSelection(itemId: string, targets: readonly WorkspaceTreeNode[]): void {
    switch (itemId) {
      case ACTION_OPEN:
        for (const node of targets) {
          void this.fileOpener.openPath(node.path);
        }
        return;
      case ACTION_COPY_PATH:
        void navigator.clipboard
          .writeText(targets.map((node: WorkspaceTreeNode): string => node.path).join('\n'))
          .catch((): void => undefined);
        return;
      case ACTION_COPY_RELATIVE:
        void navigator.clipboard
          .writeText(
            targets
              .map((node: WorkspaceTreeNode): string => this.relativePath(node.path))
              .join('\n'),
          )
          .catch((): void => undefined);
        return;
      case ACTION_DELETE:
        this.deleteTargets.set(targets);
        return;
      default:
        return;
    }
  }

  /**
   * Begins a create: opens the target directory when it is closed, so the new entry has somewhere to
   * appear, then opens a placeholder row in it to be named.
   * @param kind Whether a file or a folder is being created.
   * @param directory The directory to create in.
   * @returns Returns a promise that resolves once the placeholder is being edited.
   */
  private async beginCreate(kind: 'new-file' | 'new-folder', directory: string): Promise<void> {
    const row: WorkspaceTreeRow | undefined = this.workspace
      .rows()
      .find((candidate: WorkspaceTreeRow): boolean => candidate.node.path === directory);
    if (row !== undefined && !row.expanded) {
      await this.workspace.toggleDirectory(directory);
    }
    this.editing.set({
      kind,
      target: directory,
      rowId: PLACEHOLDER_ID,
      initial: '',
      selection: 'all',
    });
  }

  /**
   * Splices a create's placeholder row into the tree: first among the target directory's children, or
   * first in the tree when the target is the workspace root (which is not itself a row). First rather
   * than in name order, because a row that re-sorted as its name was typed would move under the cursor.
   * @param rows The tree's rows.
   * @param edit The create in progress.
   * @returns Returns the rows with the placeholder in place, or unchanged when the target directory
   * is not among them.
   */
  private withPlaceholder(rows: TreeRow[], edit: NameEdit): readonly TreeRow[] {
    let index: number = 0;
    let depth: number = 0;
    if (edit.target !== this.workspace.root()?.path) {
      const parent: number = rows.findIndex((row: TreeRow): boolean => row.id === edit.target);
      if (parent < 0) {
        return rows;
      }
      index = parent + 1;
      depth = rows[parent].depth + 1;
    }
    const placeholder: WorkspaceTreeNode = {
      name: '',
      path: PLACEHOLDER_ID,
      type: edit.kind === 'new-folder' ? 'directory' : 'file',
      expanded: false,
      loading: false,
      children: null,
    };
    rows.splice(index, 0, {
      id: PLACEHOLDER_ID,
      depth,
      expandable: false,
      expanded: false,
      data: placeholder,
    });
    return rows;
  }

  /**
   * Ends the naming operation without acting on it — the edit was abandoned, or committed with no new
   * name to apply. A create's placeholder row goes with it.
   */
  public onEditCancel(): void {
    this.editing.set(null);
  }

  /**
   * Runs the naming operation with the name the row was given, then ends it.
   *
   * The row returns to showing the entry whether or not the write succeeded: a failure is reported as a
   * notification, and holding the field open over a name the main process has already rejected would
   * leave the user retyping into a box with no indication of which part it objected to. A success
   * selects the entry under its new name, since the one that was selected no longer exists.
   * @param commit The edited row and the trimmed name it was given.
   * @returns Returns a promise that resolves once the operation has been attempted.
   */
  public async onEditCommit(commit: TreeEdit): Promise<void> {
    const edit: NameEdit | null = this.editing();
    if (commit.row.id !== edit?.rowId) {
      return;
    }
    this.editing.set(null);
    const name: string = commit.value;
    const result: FileOperationResult =
      edit.kind === 'rename'
        ? await this.workspace.rename(edit.target, name)
        : edit.kind === 'new-folder'
          ? await this.workspace.createFolder(edit.target, name)
          : await this.workspace.createFile(edit.target, name);
    if (!result.success) {
      this.report(this.editFailureTitle(edit.kind), result.error);
      return;
    }
    if (result.path === undefined) {
      return;
    }
    this.workspace.select(result.path);
    // A newly created file is what the user is about to type into, so open it; a new folder and a
    // rename have nothing to open.
    if (edit.kind === 'new-file') {
      void this.fileOpener.openPath(result.path);
    }
  }

  /**
   * Names the failure of a naming operation for its notification.
   * @param kind The operation that failed.
   * @returns Returns the notification title.
   */
  private editFailureTitle(kind: NameEditKind): string {
    switch (kind) {
      case 'rename':
        return 'Could not rename';
      case 'new-folder':
        return 'Could not create folder';
      default:
        return 'Could not create file';
    }
  }

  /**
   * Gets the delete confirmation's heading: the entry by name, or how many there are.
   */
  protected readonly deleteTitle: Signal<string> = computed((): string => {
    const targets: readonly WorkspaceTreeNode[] = this.deleteTargets() ?? [];
    return targets.length === 1
      ? `Delete “${targets[0].name}”?`
      : `Delete ${targets.length} items?`;
  });

  /**
   * Closes the delete confirmation without deleting anything.
   */
  public cancelDelete(): void {
    this.deleteTargets.set(null);
  }

  /**
   * Deletes the confirmed entries, one after another, saying afterwards what did not go to the Trash
   * and what could not be deleted — once for them all, rather than a notification per entry.
   * @returns Returns a promise that settles once every entry has been tried.
   */
  public async confirmDelete(): Promise<void> {
    const targets: readonly WorkspaceTreeNode[] | null = this.deleteTargets();
    if (targets === null || targets.length === 0) {
      return;
    }
    this.deleteTargets.set(null);
    const failed: { node: WorkspaceTreeNode; error: string | undefined }[] = [];
    const permanent: WorkspaceTreeNode[] = [];
    for (const node of targets) {
      this.log.info('workspace.tree', 'Delete requested', node.path);
      const result: FileOperationResult = await this.workspace.delete(node.path);
      if (!result.success) {
        failed.push({ node, error: result.error });
      } else if (result.trashed === false) {
        permanent.push(node);
      }
    }
    if (failed.length > 0) {
      this.report(
        failed.length === 1 && targets.length === 1
          ? 'Could not delete'
          : `Could not delete ${failed.length} of ${targets.length} items`,
        failed.length === 1
          ? failed[0].error
          : failed.map(({ node }: { node: WorkspaceTreeNode }): string => node.name).join(', '),
      );
    }
    if (permanent.length > 0) {
      this.notifications.notify({
        severity: 'warning',
        title:
          permanent.length === 1
            ? `Deleted “${permanent[0].name}” permanently`
            : `Deleted ${permanent.length} items permanently`,
        detail: 'This location has no Trash, so it could not be recovered from there.',
      });
    }
  }

  /**
   * Reports a failed write as a notification, since the row or dialog it came from has already closed.
   * @param title The notification's headline.
   * @param detail The failure's message, when the main process gave one.
   */
  private report(title: string, detail: string | undefined): void {
    this.log.warn('workspace.tree', title, detail);
    this.notifications.notify({ severity: 'error', title, detail });
  }

  /**
   * Resolves the directory a create runs in for a given row: the directory itself, or a file's parent.
   * @param node The row's node.
   * @returns Returns the absolute directory path.
   */
  private directoryFor(node: WorkspaceTreeNode): string {
    if (node.type === 'directory') {
      return node.path;
    }
    const cut: number = Math.max(node.path.lastIndexOf('/'), node.path.lastIndexOf('\\'));
    return cut <= 0 ? node.path : node.path.slice(0, cut);
  }

  /**
   * Expresses a path relative to the workspace root, falling back to the absolute path when it lies
   * outside (which the tree's own rows never are, but a stale row during a root change could be).
   * @param path The absolute path.
   * @returns Returns the relative path, or the absolute path when it is not beneath the root.
   */
  private relativePath(path: string): string {
    const root: string | undefined = this.workspace.root()?.path;
    if (root === undefined || !path.startsWith(root)) {
      return path;
    }
    return path.slice(root.length).replace(/^[/\\]+/, '');
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
    return fileIconFor(node.name);
  }
}

/**
 * Describes an entry to the version-control commands.
 * @param node The entry.
 * @returns Returns the target.
 */
function vcsTargetOf(node: WorkspaceTreeNode): ExplorerVcsTarget {
  return { path: node.path, name: node.name, kind: node.type };
}
