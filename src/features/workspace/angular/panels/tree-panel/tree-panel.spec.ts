import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
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

import {
  ExplorerScmState,
  WorkspaceGit,
} from '@features/workspace/angular/workspace-git/workspace-git';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';
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

  public clearSelection(): void {
    this.selectedPath.set(null);
  }

  public readonly followsActiveDocument: WritableSignal<boolean> = signal<boolean>(true);
  public readonly showsGitStatus: WritableSignal<boolean> = signal<boolean>(true);
  public refreshes: number = 0;

  public toggleFollowActiveDocument(): void {
    this.followsActiveDocument.update((value: boolean): boolean => !value);
  }

  public toggleGitStatus(): void {
    this.showsGitStatus.update((value: boolean): boolean => !value);
  }

  public refreshFromDisk(): Promise<void> {
    this.refreshes += 1;
    return Promise.resolve();
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

  public readonly opened: string[] = [];

  public revealPath(path: string): Promise<void> {
    this.revealed.push(path);
    return Promise.resolve();
  }

  public openPath(path: string): Promise<void> {
    this.opened.push(path);
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

  it('rows_colourEachPathByHowVersionControlSeesIt', async () => {
    // #860: colour instead of an A/M letter — untracked red, the folders above it info.
    vi.spyOn(TestBed.inject(WorkspaceGit), 'stateFor').mockImplementation(
      (path: string): ExplorerScmState | null =>
        path === '/ws/src/new.ts' ? 'untracked' : path === '/ws/src' ? 'contains' : null,
    );
    workspace.rows.set([
      { node: node('src', '/ws/src', 'directory'), depth: 0, expanded: true },
      { node: node('new.ts', '/ws/src/new.ts', 'file'), depth: 1, expanded: false },
      { node: node('README.md', '/ws/README.md', 'file'), depth: 0, expanded: false },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const rows: Element[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.tree-row'),
    );
    expect(rows[0].classList.contains('tree-row--tone-info')).toBe(true);
    expect(rows[1].classList.contains('tree-row--tone-danger')).toBe(true);
    expect(rows[1].getAttribute('title')).toBe('Untracked — not under version control');
    expect(rows[2].className).not.toContain('tree-row--tone-');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toMatch(/\b[AM]\b/);
  });

  it('click_onTheTreesEmptySpace_clearsTheSelection', async () => {
    workspace.rows.set([
      { node: node('README.md', '/ws/README.md', 'file'), depth: 0, expanded: false },
    ]);
    workspace.select('/ws/README.md');
    fixture.detectChanges();
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.tree-list')?.click();

    expect(workspace.selectedPath()).toBeNull();
  });

  describe('the toolbar … menu', () => {
    /**
     * Gets the menu's items, as the toolbar receives them.
     * @returns Returns the items.
     */
    function moreItems(): readonly MenuItem[] {
      return (component as unknown as { moreItems: () => readonly MenuItem[] }).moreItems();
    }

    /**
     * Chooses an item from the menu.
     * @param itemId The item.
     */
    function choose(itemId: string): void {
      (component as unknown as { onMoreAction: (id: string) => void }).onMoreAction(itemId);
    }

    it('offersTheTreeAndRootCommands_underTheOptions', () => {
      expect(moreItems().map((item: MenuItem): string => item.id)).toEqual([
        'options',
        'tree-more.sep-create',
        'new-file',
        'new-folder',
        'tree-more.sep-root',
        'open-root',
        'copy-workspace-path',
        'refresh',
      ]);
      expect(moreItems()[0].children?.map((item: MenuItem): string => item.id)).toEqual([
        'follow-active',
        'git-status',
      ]);
    });

    it('newFile_opensAPlaceholderFirstAtTheWorkspaceRoot', async () => {
      // The root has no row of its own, so this is the only way to create directly inside it.
      workspace.rows.set([
        { node: node('src', '/ws/src', 'directory'), depth: 0, expanded: false },
        { node: node('README.md', '/ws/README.md', 'file'), depth: 0, expanded: false },
      ]);

      choose('new-file');
      await fixture.whenStable();

      expect(component.editing()).toMatchObject({ kind: 'new-file', target: '/ws' });
      expect(renderedRows()).toEqual(['0:<new>', '0:/ws/src', '0:/ws/README.md']);
    });

    it('newFolder_createsAtTheWorkspaceRoot', async () => {
      choose('new-folder');
      await fixture.whenStable();

      expect(component.editing()).toMatchObject({ kind: 'new-folder', target: '/ws' });
    });

    it('theOptions_toggleFollowingAndGitStatus_andShowWhichAreOn', () => {
      choose('follow-active');
      choose('git-status');

      expect(workspace.followsActiveDocument()).toBe(false);
      expect(workspace.showsGitStatus()).toBe(false);
      expect(
        moreItems()[0].children?.map((item: MenuItem): boolean | undefined => item.checked),
      ).toEqual([false, false]);
    });

    it('showGitStatus_off_dropsTheRowColours', async () => {
      vi.spyOn(TestBed.inject(WorkspaceGit), 'stateFor').mockReturnValue('modified');
      workspace.rows.set([{ node: node('a.ts', '/ws/a.ts', 'file'), depth: 0, expanded: false }]);
      choose('git-status');
      fixture.detectChanges();
      await fixture.whenStable();

      const row: Element | null = (fixture.nativeElement as HTMLElement).querySelector('.tree-row');
      expect(row?.className).not.toContain('tree-row--tone-');
    });

    it('refresh_reReadsTheTreeAndTheGitStatus', () => {
      const status: ReturnType<typeof vi.spyOn> = vi
        .spyOn(TestBed.inject(WorkspaceGit), 'refresh')
        .mockResolvedValue();

      choose('refresh');

      expect(workspace.refreshes).toBe(1);
      expect(status).toHaveBeenCalled();
    });

    it('openInFileSystem_opensTheRootsOwnContents_ratherThanRevealingIt', () => {
      // Revealing would show the root selected inside whatever folder happens to contain it.
      const open: MenuItem | undefined = moreItems().find(
        (item: MenuItem): boolean => item.id === 'open-root',
      );
      expect(open?.label).toBe(OPEN_IN_FILE_SYSTEM_LABEL);

      choose('open-root');

      expect(shell.opened).toEqual(['/ws']);
      expect(shell.revealed).toEqual([]);
    });

    it('copyWorkspacePath_copiesTheRoot', () => {
      const write: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: write },
        configurable: true,
      });

      choose('copy-workspace-path');

      expect(write).toHaveBeenCalledWith('/ws');
    });
  });

  it('rows_anExpandedFolder_isNotBold', async () => {
    // Opening a folder is navigation, not emphasis: the weight is kept for a conflicted file.
    workspace.rows.set([{ node: node('src', '/ws/src', 'directory'), depth: 0, expanded: true }]);
    fixture.detectChanges();
    await fixture.whenStable();

    const name: Element | null = (fixture.nativeElement as HTMLElement).querySelector('.tree-name');
    expect(name?.classList.contains('bold')).toBe(false);
  });

  it('contextMenuFor_offersAddToVersionControl_onlyOnAnUntrackedPath', () => {
    // #860: nothing is added unasked — the command is the only way a new path becomes tracked.
    const git: WorkspaceGit = TestBed.inject(WorkspaceGit);
    vi.spyOn(git, 'canAddToVersionControl').mockImplementation(
      (path: string): boolean => path === '/ws/new.ts',
    );
    const add: ReturnType<typeof vi.spyOn> = vi
      .spyOn(git, 'addToVersionControl')
      .mockResolvedValue({ success: true });

    expect(itemIds(node('new.ts', '/ws/new.ts', 'file'))).toContain('add-to-version-control');
    expect(itemIds(node('old.ts', '/ws/old.ts', 'file'))).not.toContain('add-to-version-control');

    component.onContextAction({
      itemId: 'add-to-version-control',
      row: treeRow(node('new.ts', '/ws/new.ts', 'file')),
    });
    expect(add).toHaveBeenCalledWith('/ws/new.ts');
  });

  it('contextMenuFor_offersShowDiff_onlyOnAModifiedFile_andOpensItsDiff', () => {
    const git: WorkspaceGit = TestBed.inject(WorkspaceGit);
    vi.spyOn(git, 'canShowDiff').mockImplementation(
      (path: string): boolean => path === '/ws/changed.ts' || path === '/ws/src',
    );
    const open: ReturnType<typeof vi.spyOn> = vi
      .spyOn(TestBed.inject(DiffOpener), 'openPath')
      .mockResolvedValue(null);

    expect(itemIds(node('changed.ts', '/ws/changed.ts', 'file'))).toContain('show-diff');
    expect(itemIds(node('same.ts', '/ws/same.ts', 'file'))).not.toContain('show-diff');
    // A folder has no diff of its own, whatever is changed beneath it.
    expect(itemIds(node('src', '/ws/src', 'directory'))).not.toContain('show-diff');

    component.onContextAction({
      itemId: 'show-diff',
      row: treeRow(node('changed.ts', '/ws/changed.ts', 'file')),
    });
    expect(open).toHaveBeenCalledWith('/ws/changed.ts');
  });

  it('onContextAction_showDiff_whenThereIsNoDiff_saysWhy', async () => {
    vi.spyOn(TestBed.inject(DiffOpener), 'openPath').mockResolvedValue(
      '"changed.ts" has no changes against HEAD, so there is no diff to show.',
    );
    const notify: ReturnType<typeof vi.spyOn> = vi.spyOn(TestBed.inject(Notifications), 'notify');

    component.onContextAction({
      itemId: 'show-diff',
      row: treeRow(node('changed.ts', '/ws/changed.ts', 'file')),
    });
    await fixture.whenStable();

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', title: 'No diff for “changed.ts”' }),
    );
  });

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
