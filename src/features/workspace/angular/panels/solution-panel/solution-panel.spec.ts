import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectModel } from '@shared/api/project-system';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { SolutionModel, SolutionRow } from '@features/workspace/angular/project/solution-model';
import { Icon } from '@shared/angular/icons/icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Shell } from '@shared/angular/services/shell/shell';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
import { SolutionPanel } from './solution-panel';

/**
 * A fake solution model whose rows and model presence the test sets, recording toggles, search queries,
 * and expand/collapse calls the panel forwards from its toolbar.
 */
class FakeSolutionModel {
  public readonly model: WritableSignal<ProjectModel | null> = signal<ProjectModel | null>(null);
  public readonly rows: WritableSignal<readonly SolutionRow[]> = signal<readonly SolutionRow[]>([]);
  public readonly query: WritableSignal<string> = signal<string>('');
  public readonly selectedKey: WritableSignal<string | null> = signal<string | null>(null);
  public readonly followsActiveDocument: WritableSignal<boolean> = signal<boolean>(true);
  public readonly showsGitStatus: WritableSignal<boolean> = signal<boolean>(true);
  public readonly toggled: SolutionRow[] = [];
  public readonly queries: string[] = [];
  public expandAllCount: number = 0;
  public collapseAllCount: number = 0;
  public refreshCount: number = 0;

  public toggle(row: SolutionRow): void {
    this.toggled.push(row);
  }

  public toggleFollowActiveDocument(): void {
    this.followsActiveDocument.update((value: boolean): boolean => !value);
  }

  public toggleGitStatus(): void {
    this.showsGitStatus.update((value: boolean): boolean => !value);
  }

  public refreshFromDisk(): void {
    this.refreshCount++;
  }

  public select(key: string): void {
    this.selectedKey.set(key);
  }

  public setQuery(value: string): void {
    this.queries.push(value);
    this.query.set(value);
  }

  public expandAll(): void {
    this.expandAllCount++;
  }

  public collapseAll(): void {
    this.collapseAllCount++;
  }
}

/**
 * A fake shell that records revealed paths.
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
 * A fake opener that records opened paths.
 */
class FakeOpener {
  public readonly opened: string[] = [];

  public openPath(path: string): Promise<void> {
    this.opened.push(path);
    return Promise.resolve();
  }
}

/**
 * Builds a row with sensible defaults.
 * @param overrides The fields to override.
 * @returns Returns the row.
 */
function makeRow(overrides: Partial<SolutionRow>): SolutionRow {
  return {
    key: overrides.key ?? overrides.label ?? 'row',
    depth: 0,
    label: 'row',
    kind: 'project',
    expandable: false,
    expanded: false,
    loading: false,
    path: null,
    ...overrides,
  };
}

describe('SolutionPanel', () => {
  let component: SolutionPanel;
  let fixture: ComponentFixture<SolutionPanel>;
  let solution: FakeSolutionModel;
  let opener: FakeOpener;
  let shell: FakeShell;
  let copied: string[];

  const panel: DockPanel = {
    id: 'solution',
    title: 'Solution Explorer',
    icon: Icon.SOLUTION_EXPLORER,
    role: 'tool',
    component: SolutionPanel,
  };

  const model: ProjectModel = {
    kind: 'dotnet',
    root: '/root',
    solution: null,
    projects: [],
    tree: [],
    capabilities: { actions: [], buildConfigurations: [], target: null, debug: null },
  };

  beforeEach(async () => {
    solution = new FakeSolutionModel();
    opener = new FakeOpener();
    shell = new FakeShell();
    copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string): Promise<void> => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
    await TestBed.configureTestingModule({
      imports: [SolutionPanel],
      providers: [
        { provide: SolutionModel, useValue: solution },
        { provide: FileOpener, useValue: opener },
        { provide: Shell, useValue: shell },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SolutionPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
  });

  /**
   * Gets the rendered row buttons.
   * @returns Returns the row buttons.
   */
  function rowButtons(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.tree-row'),
    );
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoModel_showsEmptyState', () => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'No solution or projects detected',
    );
  });

  it('render_whenModelPresent_showsARowPerVisibleNode', () => {
    solution.model.set(model);
    solution.rows.set([
      makeRow({ key: 'f', label: 'Group', kind: 'folder', expandable: true, expanded: true }),
      makeRow({ key: 'p', label: 'A', kind: 'project', expandable: true }),
      makeRow({ key: 'file', label: 'g.cs', kind: 'file', path: '/root/A/g.cs' }),
    ]);
    fixture.detectChanges();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(rowButtons()).toHaveLength(3);
    expect(text).toContain('Group');
    expect(text).toContain('A');
    expect(text).toContain('g.cs');
  });

  it('onRowClick_anExpandableRow_togglesIt', () => {
    const folder: SolutionRow = makeRow({ label: 'Group', kind: 'folder', expandable: true });
    solution.model.set(model);
    solution.rows.set([folder]);
    fixture.detectChanges();

    rowButtons()[0].click();

    expect(solution.toggled).toEqual([folder]);
    expect(opener.opened).toEqual([]);
  });

  it('onRowClick_aFileRow_opensIt', () => {
    solution.model.set(model);
    solution.rows.set([
      makeRow({ label: 'g.cs', kind: 'file', expandable: false, path: '/root/A/g.cs' }),
    ]);
    fixture.detectChanges();

    rowButtons()[0].click();

    expect(opener.opened).toEqual(['/root/A/g.cs']);
    expect(solution.toggled).toEqual([]);
  });

  /**
   * Wraps a solution row as the tree row the context menu is opened with.
   * @param row The solution row.
   * @returns Returns the tree row.
   */
  function treeRow(row: SolutionRow): TreeRow {
    return {
      id: row.key,
      depth: row.depth,
      expandable: row.expandable,
      expanded: row.expanded,
      data: row,
    };
  }

  /**
   * Gets the ids of the context-menu items offered for a row.
   * @param row The row to open the menu on.
   * @returns Returns the item ids.
   */
  function menuIds(row: SolutionRow): string[] {
    return component.contextMenuFor(treeRow(row)).map((item: MenuItem): string => item.id);
  }

  describe('context menu', () => {
    it('contextMenuFor_aFile_offersOpenAndThePathActions', () => {
      const ids: string[] = menuIds(makeRow({ kind: 'file', path: '/root/A/g.cs' }));
      expect(ids).toEqual(['open', 'copy-path', 'copy-relative-path', 'reveal']);
    });

    it('contextMenuFor_aProject_offersEditProjectFileRatherThanOpen', () => {
      const ids: string[] = menuIds(makeRow({ kind: 'project', path: '/root/A/A.csproj' }));
      expect(ids).toEqual(['edit-project', 'copy-path', 'copy-relative-path', 'reveal']);
    });

    it('contextMenuFor_theWorkspaceRoot_offersThePathActionsAgainstTheSolutionRoot', () => {
      // The root row is synthesised to head the tree and carries no path of its own, but it stands
      // for the root directory — and it is the one row every solution has.
      solution.model.set(model);
      expect(menuIds(makeRow({ kind: 'solution', path: null }))).toEqual([
        'copy-path',
        'copy-relative-path',
        'reveal',
      ]);
    });

    it('onContextAction_theWorkspaceRoot_revealsTheSolutionRoot', () => {
      solution.model.set(model);
      const row: SolutionRow = makeRow({ kind: 'solution', path: null });
      component.onContextAction({ itemId: 'reveal', row: treeRow(row) });

      expect(shell.revealed).toEqual(['/root']);
    });

    it('contextMenuFor_aSolutionFolder_offersNothing', () => {
      // A solution folder is a grouping inside the .sln with no directory behind it, so a path
      // command would have to invent one. The tree suppresses the menu rather than open it empty.
      solution.model.set(model);
      expect(menuIds(makeRow({ kind: 'folder', path: null }))).toEqual([]);
    });

    it('onContextAction_open_opensThePathAndSelectsTheRow', () => {
      const row: SolutionRow = makeRow({ key: 'k', kind: 'file', path: '/root/A/g.cs' });
      component.onContextAction({ itemId: 'open', row: treeRow(row) });

      expect(opener.opened).toEqual(['/root/A/g.cs']);
      expect(solution.selectedKey()).toBe('k');
    });

    it('onContextAction_editProject_opensTheProjectFileItself', () => {
      const row: SolutionRow = makeRow({ kind: 'project', path: '/root/A/A.csproj' });
      component.onContextAction({ itemId: 'edit-project', row: treeRow(row) });

      expect(opener.opened).toEqual(['/root/A/A.csproj']);
    });

    it('onContextAction_copyPath_copiesTheAbsolutePath', () => {
      const row: SolutionRow = makeRow({ kind: 'file', path: '/root/A/g.cs' });
      component.onContextAction({ itemId: 'copy-path', row: treeRow(row) });

      expect(copied).toEqual(['/root/A/g.cs']);
    });

    it('onContextAction_copyRelativePath_copiesItRelativeToTheSolutionRoot', () => {
      solution.model.set(model);
      const row: SolutionRow = makeRow({ kind: 'file', path: '/root/A/g.cs' });
      component.onContextAction({ itemId: 'copy-relative-path', row: treeRow(row) });

      expect(copied).toEqual(['A/g.cs']);
    });

    it('onContextAction_copyRelativePath_whenOutsideTheRoot_fallsBackToTheAbsolutePath', () => {
      // Project systems allow linked files from outside the tree; there is no relative form to give.
      solution.model.set(model);
      const row: SolutionRow = makeRow({ kind: 'file', path: '/elsewhere/shared.cs' });
      component.onContextAction({ itemId: 'copy-relative-path', row: treeRow(row) });

      expect(copied).toEqual(['/elsewhere/shared.cs']);
    });

    it('onContextAction_reveal_revealsThePathInTheFileManager', () => {
      const row: SolutionRow = makeRow({ kind: 'file', path: '/root/A/g.cs' });
      component.onContextAction({ itemId: 'reveal', row: treeRow(row) });

      expect(shell.revealed).toEqual(['/root/A/g.cs']);
    });

    it('onContextAction_aRowWithNoPath_doesNothing', () => {
      component.onContextAction({ itemId: 'reveal', row: treeRow(makeRow({ path: null })) });

      expect(shell.revealed).toEqual([]);
      expect(copied).toEqual([]);
    });
  });

  describe('toolbar overflow', () => {
    it('onMoreAction_syncWithActiveDocument_togglesFollowing', () => {
      expect(solution.followsActiveDocument()).toBe(true);
      component.onMoreAction('follow-active');
      expect(solution.followsActiveDocument()).toBe(false);
    });

    it('onMoreAction_showGitStatus_togglesTheBadges', () => {
      component.onMoreAction('git-status');
      expect(solution.showsGitStatus()).toBe(false);
    });

    it('onMoreAction_openInFileManager_opensTheSolutionRootItself', () => {
      // Opening, not revealing: revealing the root would show it selected inside whatever directory
      // happens to contain the workspace, rather than showing the root's own contents.
      solution.model.set(model);
      component.onMoreAction('open-root');

      expect(shell.opened).toEqual(['/root']);
      expect(shell.revealed).toEqual([]);
    });

    it('onMoreAction_openInFileManager_withNoModel_doesNothing', () => {
      component.onMoreAction('open-root');
      expect(shell.opened).toEqual([]);
    });

    it('onMoreAction_reloadSolution_rebuildsFromDisk', () => {
      component.onMoreAction('reload');
      expect(solution.refreshCount).toBe(1);
    });

    it('moreItems_reflectTheCurrentToggleStates', () => {
      // The toggles read as ticks in the menu, so their `active` flag has to track the model rather
      // than being a snapshot taken when the panel was built.
      solution.followsActiveDocument.set(false);
      fixture.detectChanges();

      const follow: MenuItem | undefined = component
        .moreItems()
        .find((item: MenuItem): boolean => item.id === 'follow-active');
      expect(follow?.active).toBe(false);
    });

    it('statusFor_whenGitStatusHidden_reportsNoBadge', () => {
      solution.model.set(model);
      solution.rows.set([makeRow({ kind: 'file', path: '/root/A/g.cs' })]);
      solution.showsGitStatus.set(false);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('.tree-status')).toBeNull();
    });
  });

  it('iconFor_resolvesByKindAndExpansion', () => {
    expect(component.iconFor(makeRow({ kind: 'solution' }))).toBe(Icon.SOLUTION_EXPLORER);
    expect(component.iconFor(makeRow({ kind: 'project' }))).toBe(Icon.PROJECT);
    expect(component.iconFor(makeRow({ kind: 'folder', expanded: true }))).toBe(Icon.FOLDER_OPEN);
    expect(component.iconFor(makeRow({ kind: 'folder', expanded: false }))).toBe(Icon.DIRECTORY);
    expect(component.iconFor(makeRow({ kind: 'file', label: 'a.ts' }))).toBe(Icon.FILE_TYPESCRIPT);
    expect(component.iconFor(makeRow({ kind: 'file', label: 'a.cs' }))).toBe(Icon.FILE);
  });
});
