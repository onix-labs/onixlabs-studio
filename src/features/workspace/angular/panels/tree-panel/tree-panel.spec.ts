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
import { Workspace, WorkspaceTreeNode } from '@shared/angular/services/workspace/workspace';
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
  public readonly rows: WritableSignal<readonly never[]> = signal<readonly never[]>([]);
  public readonly query: WritableSignal<string> = signal<string>('');
  public readonly selectedPath: WritableSignal<string | null> = signal<string | null>(null);
  public readonly created: { directory: string; name: string; type: string }[] = [];
  public readonly renamed: { path: string; name: string }[] = [];
  public readonly deleted: string[] = [];
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

  it('onContextAction_newFile_onADirectory_promptsForANameInsideIt', () => {
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('src', '/ws/src', 'directory')),
    });

    expect(component.prompt()?.kind).toBe('new-file');
    expect(component.prompt()?.target).toBe('/ws/src');
  });

  it('onContextAction_newFile_onAFile_promptsForANameAlongsideIt', () => {
    // The workspace root is not itself a row, so creating only ever inside directories would leave no
    // way to add a top-level file at all.
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('README.md', '/ws/README.md', 'file')),
    });

    expect(component.prompt()?.target).toBe('/ws');
  });

  it('onContextAction_rename_startsThePromptFromTheCurrentName', () => {
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });

    expect(component.prompt()?.kind).toBe('rename');
    expect(component.promptName()).toBe('main.ts');
  });

  it('submitPrompt_aNewFile_createsItAndOpensIt', async () => {
    workspace.result = { success: true, path: '/ws/src/added.ts' };
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('src', '/ws/src', 'directory')),
    });
    component.promptName.set('added.ts');

    await component.submitPrompt();

    expect(workspace.created).toEqual([{ directory: '/ws/src', name: 'added.ts', type: 'file' }]);
    // A new file is what the user is about to type into.
    expect(opener.opened).toEqual(['/ws/src/added.ts']);
    expect(component.prompt()).toBeNull();
  });

  it('submitPrompt_aNewFolder_createsItAndOpensNothing', async () => {
    workspace.result = { success: true, path: '/ws/tools' };
    component.onContextAction({
      itemId: 'new-folder',
      row: treeRow(node('src', '/ws/src', 'directory')),
    });
    component.promptName.set('tools');

    await component.submitPrompt();

    expect(workspace.created).toEqual([{ directory: '/ws/src', name: 'tools', type: 'directory' }]);
    expect(opener.opened).toEqual([]);
  });

  it('submitPrompt_aRename_appliesTheTrimmedName', async () => {
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });
    component.promptName.set('  entry.ts  ');

    await component.submitPrompt();

    expect(workspace.renamed).toEqual([{ path: '/ws/main.ts', name: 'entry.ts' }]);
  });

  it('submitPrompt_aBlankName_doesNothing', async () => {
    component.onContextAction({
      itemId: 'new-file',
      row: treeRow(node('src', '/ws/src', 'directory')),
    });
    component.promptName.set('   ');

    await component.submitPrompt();

    expect(workspace.created).toEqual([]);
    // The prompt stays open: nothing was asked for, so there is nothing to report or dismiss.
    expect(component.prompt()).not.toBeNull();
  });

  it('submitPrompt_whenTheWriteFails_reportsTheMainProcessMessage', async () => {
    workspace.result = { success: false, error: 'Invalid name' };
    component.onContextAction({
      itemId: 'rename',
      row: treeRow(node('main.ts', '/ws/main.ts', 'file')),
    });
    component.promptName.set('bad/name');

    await component.submitPrompt();

    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0].severity).toBe('error');
    expect(notifications.sent[0].title).toBe('Could not rename');
    expect(notifications.sent[0].detail).toBe('Invalid name');
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
