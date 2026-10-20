import { TestBed } from '@angular/core/testing';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import {
  Notifications,
  NotificationRequest,
} from '@shared/angular/services/notifications/notifications';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';

import { ExplorerScmState, WorkspaceGit } from './workspace-git';
import { ExplorerVcsMenu, ExplorerVcsTarget } from './explorer-vcs-menu';

/**
 * A fake workspace status whose paths the test puts in a state, recording the writes asked of it.
 */
class FakeWorkspaceGit {
  public readonly states: Map<string, ExplorerScmState> = new Map<string, ExplorerScmState>();
  public readonly edited: string[] = [];
  public readonly calls: string[] = [];
  public result: MutationResult = { success: true };

  public canAddToVersionControl(path: string): boolean {
    return this.states.get(path) === 'untracked';
  }

  public canUndoAdd(path: string): boolean {
    return this.states.get(path) === 'added';
  }

  public canShowDiff(path: string): boolean {
    return this.states.get(path) === 'modified';
  }

  public readonly tracked: string[] = [];

  public canIgnore(path: string): boolean {
    return this.states.get(path) === 'untracked';
  }

  public canStopTracking(path: string): boolean {
    return this.tracked.includes(path);
  }

  public ignore(path: string, extension?: string): Promise<MutationResult> {
    return this.record(extension === undefined ? `ignore ${path}` : `ignore *.${extension}`);
  }

  public stopTracking(path: string): Promise<MutationResult> {
    return this.record(`stop-tracking ${path}`);
  }

  public isConflicted(path: string): boolean {
    return this.states.get(path) === 'conflicted';
  }

  public revertableFiles(path: string): readonly string[] {
    return this.edited.filter(
      (file: string): boolean => file === path || file.startsWith(`${path}/`),
    );
  }

  public addToVersionControl(path: string): Promise<MutationResult> {
    return this.record(`add ${path}`);
  }

  public undoAdd(path: string): Promise<MutationResult> {
    return this.record(`undo-add ${path}`);
  }

  public markResolved(path: string): Promise<MutationResult> {
    return this.record(`resolve ${path}`);
  }

  public revert(files: readonly string[]): Promise<MutationResult> {
    return this.record(`revert ${files.join(',')}`);
  }

  private record(call: string): Promise<MutationResult> {
    this.calls.push(call);
    return Promise.resolve(this.result);
  }
}

/**
 * Flushes pending microtasks so a command's async chain settles.
 * @returns Returns a promise that resolves once the queue has drained.
 */
async function settle(): Promise<void> {
  await new Promise((resolve: (value: void) => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('ExplorerVcsMenu', () => {
  let menu: ExplorerVcsMenu;
  let git: FakeWorkspaceGit;
  let notified: NotificationRequest[];
  let confirmations: { message: string; detail?: string }[];
  let confirmAnswer: boolean;
  let diffs: string[];
  let openedRepository: number;

  beforeEach(() => {
    git = new FakeWorkspaceGit();
    notified = [];
    confirmations = [];
    confirmAnswer = true;
    diffs = [];
    openedRepository = 0;
    TestBed.configureTestingModule({
      providers: [
        ExplorerVcsMenu,
        { provide: WorkspaceGit, useValue: git },
        {
          provide: DiffOpener,
          useValue: {
            openPath: (path: string): Promise<string | null> => {
              diffs.push(path);
              return Promise.resolve(null);
            },
          },
        },
        {
          provide: FileSystem,
          useValue: {
            confirmDestructive: (request: {
              message: string;
              detail?: string;
            }): Promise<boolean> => {
              confirmations.push(request);
              return Promise.resolve(confirmAnswer);
            },
          },
        },
        {
          provide: Notifications,
          useValue: { notify: (request: NotificationRequest): number => notified.push(request) },
        },
        {
          provide: WorkspaceSourceControlCommands,
          useValue: { openInSourceControl: (): number => (openedRepository += 1) },
        },
      ],
    });
    menu = TestBed.inject(ExplorerVcsMenu);
  });

  /**
   * Builds a row target.
   * @param path The row's path.
   * @param kind Whether it is a file or a folder.
   * @returns Returns the target.
   */
  function target(path: string, kind: 'file' | 'directory' = 'file'): ExplorerVcsTarget {
    return { path, name: path.split('/').pop() ?? path, kind };
  }

  /**
   * Gets the labels a row offers.
   * @param row The row.
   * @returns Returns the labels.
   */
  function labels(row: ExplorerVcsTarget): string[] {
    return menu.itemsFor(row).map((item: MenuItem): string => item.label);
  }

  it('itemsFor_offersWhatFitsEachState', () => {
    git.states.set('/ws/new.ts', 'untracked');
    git.states.set('/ws/added.ts', 'added');
    git.states.set('/ws/edited.ts', 'modified');
    git.edited.push('/ws/edited.ts');
    git.states.set('/ws/both.ts', 'conflicted');

    expect(labels(target('/ws/new.ts'))).toEqual(['Add to Version Control', 'Ignore']);
    expect(labels(target('/ws/added.ts'))).toEqual(['Undo Add']);
    expect(labels(target('/ws/edited.ts'))).toEqual(['Show Differences', 'Revert Changes']);
    expect(labels(target('/ws/both.ts'))).toEqual(['Mark Resolved', 'Open in Repository']);
    expect(labels(target('/ws/same.ts'))).toEqual([]);
  });

  it('itemsFor_ignore_onAFileWithAnExtension_offersTheFileOrEveryFileLikeIt', () => {
    git.states.set('/ws/debug.log', 'untracked');
    git.states.set('/ws/.env', 'untracked');
    git.states.set('/ws/build', 'untracked');

    const ignore: MenuItem | undefined = menu
      .itemsFor(target('/ws/debug.log'))
      .find((item: MenuItem): boolean => item.label === 'Ignore');
    expect(ignore?.children?.map((item: MenuItem): string => item.label)).toEqual([
      'This File',
      'All .log Files',
    ]);
    // A dotfile's dot starts its name, not an extension; a folder is ignored as itself.
    for (const row of [target('/ws/.env'), target('/ws/build', 'directory')]) {
      const flat: MenuItem | undefined = menu
        .itemsFor(row)
        .find((item: MenuItem): boolean => item.label === 'Ignore');
      expect(flat?.id).toBe('ignore');
      expect(flat?.children).toBeUndefined();
    }
  });

  it('itemsFor_stopTracking_followsWhatIsTracked', () => {
    git.states.set('/ws/edited.ts', 'modified');
    git.edited.push('/ws/edited.ts');
    git.tracked.push('/ws/edited.ts', '/ws/same.ts');

    expect(labels(target('/ws/edited.ts'))).toEqual([
      'Show Differences',
      'Revert Changes',
      'Stop Tracking',
    ]);
    expect(labels(target('/ws/same.ts'))).toEqual(['Stop Tracking']);
  });

  it('run_ignoreAndStopTracking', async () => {
    menu.run('ignore', target('/ws/debug.log'));
    menu.run('ignore-extension', target('/ws/debug.log'));
    menu.run('stop-tracking', target('/ws/same.ts'));
    await settle();

    expect(git.calls).toEqual([
      'ignore /ws/debug.log',
      'ignore *.log',
      'stop-tracking /ws/same.ts',
    ]);
  });

  it('itemsFor_aFolder_offersRevertForTheEditedFilesBeneathIt_butNoDiff', () => {
    git.states.set('/ws/src', 'contains');
    git.edited.push('/ws/src/a.ts');

    expect(labels(target('/ws/src', 'directory'))).toEqual(['Revert Changes']);
    expect(labels(target('/ws/docs', 'directory'))).toEqual([]);
  });

  it('itemsFor_colorsNoItem', () => {
    // Context-menu icons are never coloured; Revert's confirmation is what guards it.
    git.states.set('/ws/both.ts', 'conflicted');
    git.edited.push('/ws/edited.ts');
    const items: MenuItem[] = [
      ...menu.itemsFor(target('/ws/edited.ts')),
      ...menu.itemsFor(target('/ws/both.ts')),
    ];
    expect(items.every((item: MenuItem): boolean => item.tone === undefined)).toBe(true);
  });

  it('run_revert_asksFirst_andRevertsOnlyOnYes', async () => {
    git.edited.push('/ws/edited.ts');

    confirmAnswer = false;
    expect(menu.run('revert-changes', target('/ws/edited.ts'))).toBe(true);
    await settle();
    expect(confirmations).toHaveLength(1);
    expect(git.calls).toEqual([]);

    confirmAnswer = true;
    menu.run('revert-changes', target('/ws/edited.ts'));
    await settle();
    expect(git.calls).toEqual(['revert /ws/edited.ts']);
  });

  it('run_revert_onAFolder_saysHowManyFiles_andRevertsEachOne', async () => {
    git.edited.push('/ws/src/a.ts', '/ws/src/b.ts');

    menu.run('revert-changes', target('/ws/src', 'directory'));
    await settle();

    expect(confirmations[0].message).toBe('Revert the changes to 2 files in “src”?');
    expect(confirmations[0].detail).toContain('new files are left alone');
    expect(git.calls).toEqual(['revert /ws/src/a.ts,/ws/src/b.ts']);
  });

  it('run_routesEachCommand', async () => {
    menu.run('add-to-version-control', target('/ws/new.ts'));
    menu.run('undo-add', target('/ws/added.ts'));
    menu.run('mark-resolved', target('/ws/both.ts'));
    menu.run('show-diff', target('/ws/edited.ts'));
    menu.run('open-in-repository', target('/ws/both.ts'));
    await settle();

    expect(git.calls).toEqual(['add /ws/new.ts', 'undo-add /ws/added.ts', 'resolve /ws/both.ts']);
    expect(diffs).toEqual(['/ws/edited.ts']);
    expect(openedRepository).toBe(1);
  });

  it('run_anotherCommand_isLeftToTheExplorer', () => {
    expect(menu.run('rename', target('/ws/a.ts'))).toBe(false);
  });

  it('run_aWriteThatFails_saysSo', async () => {
    git.result = { success: false, error: 'index.lock exists' };

    menu.run('undo-add', target('/ws/added.ts'));
    await settle();

    expect(notified).toEqual([
      expect.objectContaining({
        severity: 'error',
        title: 'Could not undo adding “added.ts”',
        detail: 'index.lock exists',
      }),
    ]);
  });
});
