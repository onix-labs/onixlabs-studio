import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Icon } from '@shared/angular/icons/icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import {
  Notifications,
  NotificationRequest,
} from '@shared/angular/services/notifications/notifications';
import { Shell } from '@shared/angular/services/shell/shell';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
import {
  Workspace,
  WorkspaceTreeNode,
  WorkspaceTreeRow,
} from '@shared/angular/services/workspace/workspace';
import { DirectoryListing, FileOperationResult } from '@shared/api/workspace-channels';

import { TreePanel } from './tree-panel';

/**
 * Builds a workspace tree node of the given kind.
 * @param name The entry's base name.
 * @param path The entry's absolute path.
 * @param type Whether it is a file or a directory.
 * @returns Returns the node.
 */
function node(name: string, path: string, type: 'file' | 'directory'): WorkspaceTreeNode {
  return { name, path, type, expanded: false, loading: false, children: null };
}

/**
 * Wraps a node as the tree row a context menu would be opened on.
 * @param data The node the row stands for.
 * @returns Returns the tree row.
 */
function treeRow(data: WorkspaceTreeNode): TreeRow {
  return { id: data.path, depth: 0, expandable: data.type === 'directory', expanded: false, data };
}

/**
 * A fake workspace recording the mutations the panel asks for and returning a scripted result.
 */
class FakeWorkspace {
  public readonly root: WritableSignal<DirectoryListing | null> = signal<DirectoryListing | null>({
    path: '/ws',
    name: 'ws',
    entries: [],
  });
  public readonly rows: WritableSignal<readonly WorkspaceTreeRow[]> = signal<
    readonly WorkspaceTreeRow[]
  >([]);
  public readonly query: WritableSignal<string> = signal<string>('');
  public readonly selectedPath: WritableSignal<string | null> = signal<string | null>(null);
  public readonly created: { directory: string; name: string; type: string }[] = [];
  public readonly renamed: { path: string; name: string }[] = [];
  public readonly deleted: string[] = [];
  public readonly toggled: string[] = [];
  public result: FileOperationResult = { success: true, path: '/ws/added.ts', trashed: true };

  public hasWorkspace(): boolean {
    return true;
  }

  public select(path: string): void {
    this.selectedPath.set(path);
  }

  public setQuery(value: string): void {
    this.query.set(value);
  }

  public toggleDirectory(path: string): Promise<void> {
    this.toggled.push(path);
    this.rows.update((rows: readonly WorkspaceTreeRow[]): readonly WorkspaceTreeRow[] =>
      rows.map((row: WorkspaceTreeRow): WorkspaceTreeRow =>
        row.node.path === path ? { ...row, expanded: true } : row,
      ),
    );
    return Promise.resolve();
  }

  public createFile(directory: string, name: string): Promise<FileOperationResult> {
    this.created.push({ directory, name, type: 'file' });
    return Promise.resolve(this.result);
  }

  public createFolder(directory: string, name: string): Promise<FileOperationResult> {
    this.created.push({ directory, name, type: 'directory' });
    return Promise.resolve(this.result);
  }

  public rename(path: string, name: string): Promise<FileOperationResult> {
    this.renamed.push({ path, name });
    return Promise.resolve(this.result);
  }

  public delete(path: string): Promise<FileOperationResult> {
    this.deleted.push(path);
    return Promise.resolve(this.result);
  }
}

/**
 * A fake shell recording revealed paths.
 */
class FakeShell {
  public readonly revealed: string[] = [];

  public revealPath(path: string): Promise<void> {
    this.revealed.push(path);
    return Promise.resolve();
  }
}

/**
 * A fake opener recording opened paths.
 */
class FakeFileOpener {
  public readonly opened: string[] = [];

  public openPath(path: string): Promise<boolean> {
    this.opened.push(path);
    return Promise.resolve(true);
  }
}

/**
 * A fake notification service recording what the panel reported.
 */
class FakeNotifications {
  public readonly sent: NotificationRequest[] = [];

  public notify(request: NotificationRequest): void {
    this.sent.push(request);
  }
}

describe('TreePanel', () => {
  let component: TreePanel;
  let fixture: ComponentFixture<TreePanel>;

  const panel: DockPanel = {
    id: 'files',
    title: 'File Explorer',
    icon: Icon.FILE_EXPLORER,
    role: 'tool',
    component: TreePanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TreePanel],
    }).compileComponents();

    fixture = TestBed.createComponent(TreePanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoWorkspaceOpen_showsEmptyState', () => {
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Open Folder');
  });

  it('iconFor_whenTypeScriptFile_returnsTypeScriptIcon', () => {
    expect(component.iconFor(node('main.ts', '/ws/main.ts', 'file'))).toBe(Icon.FILE_TYPESCRIPT);
  });

  it('iconFor_whenExpandedDirectory_returnsOpenFolder', () => {
    expect(component.iconFor({ ...node('src', '/ws/src', 'directory'), expanded: true })).toBe(
      Icon.FOLDER_OPEN,
    );
  });
});

describe('TreePanel row context menu', () => {
  let component: TreePanel;
  let fixture: ComponentFixture<TreePanel>;
  let workspace: FakeWorkspace;
  let shell: FakeShell;
  let opener: FakeFileOpener;
  let notifications: FakeNotifications;

  const panel: DockPanel = {
    id: 'files',
    title: 'File Explorer',
    icon: Icon.FILE_EXPLORER,
    role: 'tool',
    component: TreePanel,
  };

  beforeEach(async () => {
    workspace = new FakeWorkspace();
    shell = new FakeShell();
    opener = new FakeFileOpener();
    notifications = new FakeNotifications();

    await TestBed.configureTestingModule({
      imports: [TreePanel],
      providers: [
        { provide: Workspace, useValue: workspace },
        { provide: Shell, useValue: shell },
        { provide: FileOpener, useValue: opener },
        { provide: Notifications, useValue: notifications },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TreePanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  /**
   * Gets the ids of the items the menu offers for a row, dropping the separators.
   * @param data The node the row stands for.
   * @returns Returns the item ids.
   */
  function itemIds(data: WorkspaceTreeNode): readonly string[] {
    return component
      .contextMenuFor(treeRow(data))
      .filter((item: MenuItem): boolean => item.separator !== true)
      .map((item: MenuItem): string => item.id);
  }

  it('contextMenuFor_aFile_offersOpenTheCopiesRevealAndTheWrites', () => {
    expect(itemIds(node('main.ts', '/ws/main.ts', 'file'))).toEqual([
      'open',
      'new-file',
      'new-folder',
      'copy-path',
      'copy-relative-path',
      'reveal',
      'rename',
      'delete',
    ]);
  });

  it('contextMenuFor_aDirectory_offersTheNewCommandsInPlaceOfOpen', () => {
    // Clicking a directory row toggles it, so an Open item would either duplicate the row click or
    // mean something the tree does not do.
    const ids: readonly string[] = itemIds(node('src', '/ws/src', 'directory'));
    expect(ids).not.toContain('open');
    expect(ids).toContain('new-file');
    expect(ids).toContain('new-folder');
  });

  it('contextMenuFor_everyRow_separatesTheCopiesFromTheWrites', () => {
    // A separator is a rule in its own right, never a flag on a labelled row, so it carries no label.
    const separators: readonly MenuItem[] = component
      .contextMenuFor(treeRow(node('main.ts', '/ws/main.ts', 'file')))
      .filter((item: MenuItem): boolean => item.separator === true);

    expect(separators).toHaveLength(2);
    expect(separators.every((item: MenuItem): boolean => item.label === '')).toBe(true);
  });

  it('contextMenuFor_delete_wearsTheDangerTone', () => {
    const remove: MenuItem | undefined = component
      .contextMenuFor(treeRow(node('main.ts', '/ws/main.ts', 'file')))
      .find((item: MenuItem): boolean => item.id === 'delete');

    expect(remove?.tone).toBe('danger');
  });

  it('onContextAction_open_selectsTheRowAndOpensIt', () => {
    component.onContextAction({ itemId: 'open', row: treeRow(node('a.ts', '/ws/a.ts', 'file')) });

    expect(workspace.selectedPath()).toBe('/ws/a.ts');
    expect(opener.opened).toEqual(['/ws/a.ts']);
  });

  it('onContextAction_reveal_revealsThatPath', () => {
    component.onContextAction({ itemId: 'reveal', row: treeRow(node('a.ts', '/ws/a.ts', 'file')) });

    expect(shell.revealed).toEqual(['/ws/a.ts']);
  });

  /**
   * Gets the tree's rows as the tree view receives them, placeholder included.
   * @returns Returns the rows' ids at their depths.
   */
  function renderedRows(): readonly string[] {
    return (component as unknown as { rows: () => readonly TreeRow[] })
      .rows()
      .map(
        (row: TreeRow): string => `${row.depth}:${row.id.startsWith('\u0000') ? '<new>' : row.id}`,
      );
  }

  /**
   * Commits the row being edited with a name, as the tree reports it.
   * @param value The trimmed name.
   * @returns Returns a promise that resolves once the operation has been attempted.
   */
  function commit(value: string): Promise<void> {
    const rowId: string = component.editing()!.rowId;
    return component.onEditCommit({
      row: { ...treeRow(node('', rowId, 'file')), id: rowId },
      value,
    });
  }

  it('onContextAction_newFile_onADirectory_opensAPlaceholderFirstAmongItsChildren', async () => {
    workspace.rows.set([
      { node: node('src', '/ws/src', 'directory'), depth: 0, expanded: true },
      { node: node('b.ts', '/ws/src/b.ts', 'file'), depth: 1, expanded: false },
      { node: node('README.md', '/ws/README.md', 'file'), depth: 0, expanded: false },
    ]);
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('src', '/ws/src', 'directory')),
    });
    await fixture.whenStable();

    expect(component.editing()?.kind).toBe('new-file');
    expect(component.editing()?.target).toBe('/ws/src');
    expect(component.editing()?.initial).toBe('');
    expect(renderedRows()).toEqual(['0:/ws/src', '1:<new>', '1:/ws/src/b.ts', '0:/ws/README.md']);
  });

  it('onContextAction_newFolder_inAClosedDirectory_opensItFirst', async () => {
    workspace.rows.set([{ node: node('src', '/ws/src', 'directory'), depth: 0, expanded: false }]);
    component.onContextAction({
      itemId: 'new-folder',
      row: treeRow(node('src', '/ws/src', 'directory')),
    });
    await fixture.whenStable();

    // A placeholder inside a closed folder would have nowhere to show.
    expect(workspace.toggled).toEqual(['/ws/src']);
    expect(component.editing()?.kind).toBe('new-folder');
  });

  it('onContextAction_newFile_onAFile_opensThePlaceholderAlongsideIt', async () => {
    // The workspace root is not itself a row, so creating only ever inside directories would leave no
    // way to add a top-level file at all.
    workspace.rows.set([
      { node: node('README.md', '/ws/README.md', 'file'), depth: 0, expanded: false },
    ]);
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('README.md', '/ws/README.md', 'file')),
    });
    await fixture.whenStable();

    expect(component.editing()?.target).toBe('/ws');
    expect(renderedRows()).toEqual(['0:<new>', '0:/ws/README.md']);
  });

  it('onContextAction_rename_editsTheEntrysOwnRow_withAFilesStemSelected', () => {
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });

    expect(component.editing()).toEqual({
      kind: 'rename',
      target: '/ws/main.ts',
      rowId: '/ws/main.ts',
      initial: 'main.ts',
      selection: 'stem',
    });
  });

  it('onContextAction_renameAFolder_selectsTheWholeName', () => {
    // A dot in a folder's name does not start an extension.
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('v1.2', '/ws/v1.2', 'directory')),
    });

    expect(component.editing()?.selection).toBe('all');
  });

  it('onEditCommit_aNewFile_createsItSelectsItAndOpensIt', async () => {
    workspace.result = { success: true, path: '/ws/src/added.ts' };
    workspace.rows.set([{ node: node('src', '/ws/src', 'directory'), depth: 0, expanded: true }]);
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('src', '/ws/src', 'directory')),
    });
    await fixture.whenStable();

    await commit('added.ts');

    expect(workspace.created).toEqual([{ directory: '/ws/src', name: 'added.ts', type: 'file' }]);
    expect(workspace.selectedPath()).toBe('/ws/src/added.ts');
    // A new file is what the user is about to type into.
    expect(opener.opened).toEqual(['/ws/src/added.ts']);
    expect(component.editing()).toBeNull();
    expect(renderedRows()).toEqual(['0:/ws/src']);
  });

  it('onEditCommit_aNewFolder_createsItAndOpensNothing', async () => {
    workspace.result = { success: true, path: '/ws/tools' };
    component.onContextAction({
      itemId: 'new-folder',
      row: treeRow(node('README.md', '/ws/README.md', 'file')),
    });
    await fixture.whenStable();

    await commit('tools');

    expect(workspace.created).toEqual([{ directory: '/ws', name: 'tools', type: 'directory' }]);
    expect(opener.opened).toEqual([]);
  });

  it('onEditCommit_aRename_renamesTheEntryAndSelectsItUnderItsNewName', async () => {
    workspace.result = { success: true, path: '/ws/entry.ts' };
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });

    await commit('entry.ts');

    expect(workspace.renamed).toEqual([{ path: '/ws/main.ts', name: 'entry.ts' }]);
    // The entry that was selected no longer exists under its old name.
    expect(workspace.selectedPath()).toBe('/ws/entry.ts');
  });

  it('onEditCommit_forARowThatIsNotTheOneBeingEdited_doesNothing', async () => {
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });

    await component.onEditCommit({
      row: treeRow(node('other.ts', '/ws/other.ts', 'file')),
      value: 'x',
    });

    expect(workspace.renamed).toEqual([]);
    expect(component.editing()).not.toBeNull();
  });

  it('onEditCancel_endsTheEditAndRemovesThePlaceholder', async () => {
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('README.md', '/ws/README.md', 'file')),
    });
    await fixture.whenStable();

    component.onEditCancel();

    expect(component.editing()).toBeNull();
    expect(renderedRows()).toEqual([]);
    expect(workspace.created).toEqual([]);
  });

  it('onEditCommit_whenTheWriteFails_reportsTheMainProcessMessage', async () => {
    workspace.result = { success: false, error: 'Invalid name' };
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });

    await commit('bad/name');

    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0].severity).toBe('error');
    expect(notifications.sent[0].title).toBe('Could not rename');
    expect(notifications.sent[0].detail).toBe('Invalid name');
    expect(component.editing()).toBeNull();
  });

  it('onContextAction_delete_asksBeforeDeletingAnything', () => {
    component.onContextAction({
      itemId: 'delete',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });

    expect(component.deleteTarget()?.path).toBe('/ws/main.ts');
    expect(workspace.deleted).toEqual([]);
  });

  it('confirmDelete_deletesTheEntry_andSaysNothingWhenItReachedTheTrash', async () => {
    workspace.result = { success: true, path: '/ws/main.ts', trashed: true };
    component.deleteTarget.set(node('main.ts', '/ws/main.ts', 'file'));

    await component.confirmDelete();

    expect(workspace.deleted).toEqual(['/ws/main.ts']);
    // The confirmation already promised the Trash, and that is what happened.
    expect(notifications.sent).toEqual([]);
  });

  it('confirmDelete_whenThereWasNoTrash_saysSoRatherThanLettingThePromiseStand', async () => {
    // The confirmation said the entry could be put back. On a volume with no Trash it cannot, and
    // that is the one case where what happened is worse than what was agreed to.
    workspace.result = { success: true, path: '/mnt/share/main.ts', trashed: false };
    component.deleteTarget.set(node('main.ts', '/mnt/share/main.ts', 'file'));

    await component.confirmDelete();

    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0].severity).toBe('warning');
    expect(notifications.sent[0].title).toContain('permanently');
  });

  it('confirmDelete_whenItFails_reportsTheMainProcessMessage', async () => {
    workspace.result = { success: false, error: 'Cannot delete the workspace root' };
    component.deleteTarget.set(node('ws', '/ws', 'directory'));

    await component.confirmDelete();

    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0].severity).toBe('error');
    expect(notifications.sent[0].detail).toBe('Cannot delete the workspace root');
  });

  it('cancelDelete_deletesNothing', async () => {
    component.deleteTarget.set(node('main.ts', '/ws/main.ts', 'file'));
    component.cancelDelete();

    await component.confirmDelete();

    expect(workspace.deleted).toEqual([]);
  });
});
