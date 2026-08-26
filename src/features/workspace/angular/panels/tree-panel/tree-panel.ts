import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { GitChangeStatus, statusLetter } from '@shared/angular/services/repository/repository-data';
import {
  Workspace,
  WorkspaceTreeNode,
  WorkspaceTreeRow,
} from '@shared/angular/services/workspace/workspace';
import { FileOperationResult } from '@shared/api/workspace-channels';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Shell } from '@shared/angular/services/shell/shell';
import { REVEAL_LABEL } from '@shared/angular/services/shell/shell-labels';
import { Icon } from '@shared/angular/icons/icon';
import { ExplorerToolbar } from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import { HighlightedText } from '@shared/angular/components/highlighted-text/highlighted-text';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';
import { Button } from '@shared/angular/components/forms/button/button';

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
 * Which naming operation an open name prompt is collecting a name for.
 */
type NamePromptKind = 'new-file' | 'new-folder' | 'rename';

/**
 * A naming operation awaiting the name the user is typing.
 */
interface NamePrompt {
  /**
   * Gets which operation the name is for.
   */
  readonly kind: NamePromptKind;

  /**
   * Gets the directory a create happens in, or the absolute path of the entry a rename renames.
   */
  readonly target: string;

  /**
   * Gets the prompt's heading.
   */
  readonly title: string;
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
 * system's trash, and the confirmation says so.
 */
@Component({
  selector: 'app-tree-panel',
  imports: [
    Button,
    AppIcon,
    TreeView,
    ExplorerToolbar,
    HighlightedText,
    Modal,
    ModalContent,
    TextField,
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
   * Maps a change status to its badge letter, exposed for the template.
   */
  protected readonly statusLetter: (status: GitChangeStatus) => string = statusLetter;

  /**
   * Holds the opener used to open a file into the right editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

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
   * Holds the open name prompt, or null when none is open.
   */
  public readonly prompt: WritableSignal<NamePrompt | null> = signal<NamePrompt | null>(null);

  /**
   * Holds the name being typed into the open prompt.
   */
  public readonly promptName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the entry awaiting a delete confirmation, or null when none is pending.
   */
  public readonly deleteTarget: WritableSignal<WorkspaceTreeNode | null> =
    signal<WorkspaceTreeNode | null>(null);

  /**
   * Gets whether the open prompt has a name worth submitting. A name is trimmed before it is used, so
   * whitespace alone is nothing; the main process still has the final say on what is a valid segment.
   */
  protected readonly canSubmitPrompt: Signal<boolean> = computed(
    (): boolean => this.promptName().trim().length > 0,
  );

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
      this.log.debug('workspace.tree', 'Toggle directory', node.path);
      void this.workspace.toggleDirectory(node.path);
    } else {
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
   */
  public readonly contextMenuFor: (treeRow: TreeRow) => readonly MenuItem[] = (
    treeRow: TreeRow,
  ): readonly MenuItem[] => {
    const node: WorkspaceTreeNode = this.nodeOf(treeRow);
    const items: MenuItem[] = [];

    if (node.type === 'file') {
      items.push({ id: ACTION_OPEN, label: 'Open', icon: Icon.FILE });
    }
    items.push(
      { id: ACTION_NEW_FILE, label: 'New File…', icon: Icon.FILE },
      { id: ACTION_NEW_FOLDER, label: 'New Folder…', icon: Icon.DIRECTORY },
      // A separator is a rule in its own right rather than a flag on the row below it, so it is only
      // pushed where there is genuinely something to divide.
      { id: 'tree-menu.sep-paths', label: '', separator: true },
      { id: ACTION_COPY_PATH, label: 'Copy Path', icon: Icon.COPY },
      { id: ACTION_COPY_RELATIVE, label: 'Copy Relative Path', icon: Icon.COPY },
      { id: ACTION_REVEAL, label: REVEAL_LABEL, icon: Icon.DIRECTORY },
      { id: 'tree-menu.sep-writes', label: '', separator: true },
      { id: ACTION_RENAME, label: 'Rename…', icon: Icon.PENCIL },
      { id: ACTION_DELETE, label: 'Delete', icon: Icon.TRASH, tone: 'danger' },
    );
    return items;
  };

  /**
   * Runs the command chosen from a row's context menu.
   * @param selection The chosen item and the row it was chosen for.
   */
  public onContextAction(selection: TreeMenuSelection): void {
    const node: WorkspaceTreeNode = this.nodeOf(selection.row);
    switch (selection.itemId) {
      case ACTION_OPEN:
        this.workspace.select(node.path);
        void this.fileOpener.openPath(node.path);
        return;
      case ACTION_NEW_FILE:
        this.openPrompt('new-file', this.directoryFor(node), 'New file');
        return;
      case ACTION_NEW_FOLDER:
        this.openPrompt('new-folder', this.directoryFor(node), 'New folder');
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
        this.openPrompt('rename', node.path, `Rename “${node.name}”`);
        this.promptName.set(node.name);
        return;
      case ACTION_DELETE:
        this.deleteTarget.set(node);
        return;
      default:
        return;
    }
  }

  /**
   * Opens the name prompt for a naming operation, starting from an empty name.
   * @param kind The operation the name is for.
   * @param target The directory to create in, or the entry to rename.
   * @param title The prompt's heading.
   */
  private openPrompt(kind: NamePromptKind, target: string, title: string): void {
    this.promptName.set('');
    this.prompt.set({ kind, target, title });
  }

  /**
   * Closes the name prompt without acting on it.
   */
  public cancelPrompt(): void {
    this.prompt.set(null);
  }

  /**
   * Runs the open name prompt's operation with the typed name, then closes it.
   *
   * The prompt closes whether or not the write succeeded: a failure is reported as a notification, and
   * holding the dialog open over a name the main process has already rejected would leave the user
   * retyping into a box with no indication of which part it objected to.
   * @returns Returns a promise that resolves once the operation has been attempted.
   */
  public async submitPrompt(): Promise<void> {
    const prompt: NamePrompt | null = this.prompt();
    const name: string = this.promptName().trim();
    if (prompt === null || name.length === 0) {
      return;
    }
    this.prompt.set(null);
    const result: FileOperationResult =
      prompt.kind === 'rename'
        ? await this.workspace.rename(prompt.target, name)
        : prompt.kind === 'new-folder'
          ? await this.workspace.createFolder(prompt.target, name)
          : await this.workspace.createFile(prompt.target, name);
    if (!result.success) {
      this.report(this.promptFailureTitle(prompt.kind), result.error);
      return;
    }
    // A newly created file is what the user is about to type into, so open it; a new folder and a
    // rename have nothing to open.
    if (prompt.kind === 'new-file' && result.path !== undefined) {
      void this.fileOpener.openPath(result.path);
    }
  }

  /**
   * Names the failure of a naming operation for its notification.
   * @param kind The operation that failed.
   * @returns Returns the notification title.
   */
  private promptFailureTitle(kind: NamePromptKind): string {
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
   * Gets the name of the entry awaiting deletion, for the confirmation's heading.
   */
  protected readonly deleteLabel: Signal<string> = computed(
    (): string => this.deleteTarget()?.name ?? '',
  );

  /**
   * Closes the delete confirmation without deleting anything.
   */
  public cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  /**
   * Deletes the confirmed entry.
   *
   * The confirmation promises the Trash, because that is what the main process reaches for first. Where
   * no trash exists the entry is still removed — the user asked for a delete — but that outcome is
   * reported rather than passed over in silence, since it is the one case where what happened is worse
   * than what was agreed to.
   * @returns Returns a promise that resolves once the delete has been attempted.
   */
  public async confirmDelete(): Promise<void> {
    const node: WorkspaceTreeNode | null = this.deleteTarget();
    if (node === null) {
      return;
    }
    this.deleteTarget.set(null);
    this.log.info('workspace.tree', 'Delete requested', node.path);
    const result: FileOperationResult = await this.workspace.delete(node.path);
    if (!result.success) {
      this.report('Could not delete', result.error);
      return;
    }
    if (result.trashed === false) {
      this.notifications.notify({
        severity: 'warning',
        title: `Deleted “${node.name}” permanently`,
        detail: 'This location has no Trash, so it could not be recovered from there.',
      });
    }
  }

  /**
   * Reports a failed write as a notification, since the dialog it came from has already closed.
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
