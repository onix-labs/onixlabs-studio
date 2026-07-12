import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectModel } from '@shared/api/project-system';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { SolutionModel, SolutionRow } from '@features/workspace/angular/project/solution-model';
import { Icon } from '@shared/angular/icons/icon';
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
  public readonly toggled: SolutionRow[] = [];
  public readonly queries: string[] = [];
  public expandAllCount: number = 0;
  public collapseAllCount: number = 0;

  public toggle(row: SolutionRow): void {
    this.toggled.push(row);
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
  };

  beforeEach(async () => {
    solution = new FakeSolutionModel();
    opener = new FakeOpener();
    await TestBed.configureTestingModule({
      imports: [SolutionPanel],
      providers: [
        { provide: SolutionModel, useValue: solution },
        { provide: FileOpener, useValue: opener },
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

  it('iconFor_resolvesByKindAndExpansion', () => {
    expect(component.iconFor(makeRow({ kind: 'solution' }))).toBe(Icon.SOLUTION_EXPLORER);
    expect(component.iconFor(makeRow({ kind: 'project' }))).toBe(Icon.PROJECT);
    expect(component.iconFor(makeRow({ kind: 'folder', expanded: true }))).toBe(Icon.FOLDER_OPEN);
    expect(component.iconFor(makeRow({ kind: 'folder', expanded: false }))).toBe(Icon.DIRECTORY);
    expect(component.iconFor(makeRow({ kind: 'file', label: 'a.ts' }))).toBe(Icon.FILE_TYPESCRIPT);
    expect(component.iconFor(makeRow({ kind: 'file', label: 'a.cs' }))).toBe(Icon.FILE);
  });
});
