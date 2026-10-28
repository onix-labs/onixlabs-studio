import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import {
  Diagnostic,
  Diagnostics,
  DiagnosticsProvider,
} from '@shared/angular/services/diagnostics/diagnostics';
import { Documents } from '@shared/angular/services/documents/documents';
import { Icon } from '@shared/angular/icons/icon';

import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import type { MockInstance } from 'vitest';

import { SolutionModel } from '@features/workspace/angular/project/solution-model';
import { LspServer, LspStatus } from '@shared/angular/services/lsp/lsp-status';
import { ProblemsPanel } from './problems-panel';
import type { ProblemOwner } from './problems-grouping';

/**
 * A provider whose single contribution the test pushes immediately on connect.
 */
class StaticProvider implements DiagnosticsProvider {
  public readonly id: string = 'static';

  public constructor(private readonly diagnostics: readonly Diagnostic[]) {}

  public connect(onChange: (diagnostics: readonly Diagnostic[]) => void): () => void {
    onChange(this.diagnostics);
    return (): void => undefined;
  }
}

describe('ProblemsPanel', () => {
  let component: ProblemsPanel;
  let fixture: ComponentFixture<ProblemsPanel>;

  const panel: DockPanel = {
    id: 'errors',
    title: 'Error List',
    icon: Icon.PROBLEMS,
    role: 'tool',
    component: ProblemsPanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProblemsPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ProblemsPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoDiagnostics_showsTheEmptyState', () => {
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // A green tick and that nothing was found, in a workspace with no solution (#1182).
    expect(text).toContain('No problems found in this workspace');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.problems-empty__ok'),
    ).not.toBeNull();
  });

  it('render_whenDiagnosticsReported_listsTheMessage', () => {
    TestBed.inject(Documents).ensure('doc-1');
    const diagnostics: Diagnostics = TestBed.inject(Diagnostics);
    diagnostics.register(
      new StaticProvider([
        {
          file: 'main.ts',
          message: 'Cannot find name',
          severity: 'error',
          line: 3,
          column: 5,
          source: 'typescript',
          documentId: 'doc-1',
          path: '/ws/main.ts',
        },
      ]),
    );
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Cannot find name');
    // Grouped by default (#1182): under its file, the problem names only its line and column.
    expect(text).toContain('main.ts');
    expect(text).toContain('3:5');
  });

  it('filter_bySeverity_showsOnlyTheChosenSeverity', () => {
    const documents: Documents = TestBed.inject(Documents);
    documents.ensure('doc-1');
    const diagnostics: Diagnostics = TestBed.inject(Diagnostics);
    diagnostics.register(
      new StaticProvider([
        {
          file: 'main.ts',
          message: 'a genuine error',
          severity: 'error',
          line: 3,
          column: 5,
          source: 'typescript',
          documentId: 'doc-1',
          path: '/ws/main.ts',
        },
        {
          file: 'main.ts',
          message: 'a mere warning',
          severity: 'warning',
          line: 4,
          column: 1,
          source: 'eslint',
          documentId: 'doc-1',
          path: '/ws/main.ts',
        },
      ]),
    );
    fixture.detectChanges();

    // Click the "Warnings" severity toggle button in the tool-strip.
    const warnings: HTMLButtonElement | undefined = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'app-panel-toolbar button',
      ),
    ).find((button: HTMLButtonElement): boolean => (button.textContent ?? '').includes('Warnings'));
    warnings!.click();
    fixture.detectChanges();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('a mere warning');
    expect(text).not.toContain('a genuine error');
  });

  it('reveal_aProblemInAFileThatIsNotOpen_opensItAtTheProblem (#1144)', () => {
    const navigation: EditorNavigation = TestBed.inject(EditorNavigation);
    const goTo: MockInstance<EditorNavigation['goTo']> = vi
      .spyOn(navigation, 'goTo')
      .mockResolvedValue(undefined);

    component.reveal({
      file: 'Broken.cs',
      message: 'Cannot implicitly convert type string to int',
      severity: 'error',
      line: 5,
      column: 34,
      source: 'csharp',
      documentId: null,
      path: '/root/src/Broken.cs',
      scope: 'workspace',
    });

    expect(goTo).toHaveBeenCalledWith(null, {
      path: '/root/src/Broken.cs',
      range: { startLineNumber: 5, startColumn: 34, endLineNumber: 5, endColumn: 34 },
    });
  });

  describe('grouped by project and file (#1182)', () => {
    /**
     * A problem in a file.
     * @param path The file's absolute path.
     * @param message The message.
     * @param line Its line.
     * @param severity Its severity.
     * @returns Returns the problem.
     */
    function problem(
      path: string,
      message: string,
      line: number,
      severity: Diagnostic['severity'] = 'error',
    ): Diagnostic {
      return {
        file: path.split('/').pop() ?? path,
        message,
        severity,
        line,
        column: 9,
        source: 'csharp',
        documentId: null,
        path,
        scope: 'workspace',
      };
    }

    const OWNERS: Readonly<Record<string, ProblemOwner>> = {
      core: { name: 'Fixture.Core', path: '/ws/Core/Core.csproj', directory: '/ws/Core' },
      services: {
        name: 'Fixture.Services',
        path: '/ws/Services/Services.csproj',
        directory: '/ws/Services',
      },
    };

    /**
     * Builds the panel over a project model that owns /ws/Core and /ws/Services, showing problems.
     * @param problems The problems.
     * @returns Returns the panel's element.
     */
    async function show(problems: readonly Diagnostic[]): Promise<HTMLElement> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ProblemsPanel],
        providers: [
          { provide: ActiveWorkspace, useValue: { rootPath: signal<string | null>('/ws') } },
          {
            provide: SolutionModel,
            useValue: {
              settled: (): boolean => true,
              model: (): null => null,
              owningProject: (path: string): ProblemOwner | null =>
                path.startsWith('/ws/Core/')
                  ? OWNERS['core']
                  : path.startsWith('/ws/Services/')
                    ? OWNERS['services']
                    : null,
            },
          },
        ],
      }).compileComponents();
      TestBed.inject(Diagnostics).register(new StaticProvider(problems));
      fixture = TestBed.createComponent(ProblemsPanel);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('panel', panel);
      await fixture.whenStable();
      return fixture.nativeElement as HTMLElement;
    }

    /**
     * Reads the tree's rows as text.
     * @param host The panel's element.
     * @returns Returns each row's text, trimmed.
     */
    function rows(host: HTMLElement): string[] {
      return [...host.querySelectorAll<HTMLElement>('.tree-row')].map((row: HTMLElement): string =>
        (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    }

    it('listsEachProjectThenEachFile_withCounts_otherFilesLast', async () => {
      const host: HTMLElement = await show([
        problem('/ws/Services/FormalGreeter.cs', 'CS0029 cannot convert', 13),
        problem('/ws/Core/Person.cs', 'CS0103 name does not exist', 8),
        problem('/ws/Core/Person.cs', 'CS0168 declared but never used', 3, 'warning'),
        problem('/ws/tools/Script.cs', 'IDE0005 using is unnecessary', 1, 'hint'),
      ]);

      expect(rows(host)).toEqual([
        'Fixture.Core 1 1',
        'Person.cs2',
        'CS0168 declared but never usedcsharp 3:9',
        'CS0103 name does not existcsharp 8:9',
        'Fixture.Services 1',
        'FormalGreeter.cs1',
        'CS0029 cannot convertcsharp 13:9',
        'Other Files 1',
        'tools/Script.cs1',
        'IDE0005 using is unnecessarycsharp 1:9',
      ]);
    });

    it('aGroupFolds_andExpandAllCollapseAllActOnEveryGroup', async () => {
      const host: HTMLElement = await show([
        problem('/ws/Core/Person.cs', 'one', 1),
        problem('/ws/Services/Greeter.cs', 'two', 2),
      ]);
      const click: (selector: string, text: string) => Promise<void> = async (
        selector: string,
        text: string,
      ): Promise<void> => {
        [...host.querySelectorAll<HTMLElement>(selector)]
          .find((element: HTMLElement): boolean => (element.textContent ?? '').includes(text))
          ?.click();
        await fixture.whenStable();
      };
      const button: (label: string) => Promise<void> = async (label: string): Promise<void> => {
        host
          .querySelector<HTMLButtonElement>(`app-panel-toolbar button[aria-label="${label}"]`)
          ?.click();
        await fixture.whenStable();
      };

      await click('.tree-row', 'Fixture.Core');
      expect(rows(host)).toEqual([
        'Fixture.Core 1',
        'Fixture.Services 1',
        'Greeter.cs1',
        'twocsharp 2:9',
      ]);

      await button('Collapse All');
      expect(rows(host)).toEqual(['Fixture.Core 1', 'Fixture.Services 1']);

      await button('Expand All');
      expect(rows(host)).toHaveLength(6);
    });

    it('choosingAProblem_revealsIt_evenInAFileThatIsNotOpen', async () => {
      const host: HTMLElement = await show([problem('/ws/Core/Person.cs', 'one', 4)]);
      const goTo: MockInstance<EditorNavigation['goTo']> = vi
        .spyOn(TestBed.inject(EditorNavigation), 'goTo')
        .mockResolvedValue(undefined);

      host.querySelectorAll<HTMLElement>('.tree-row')[2]?.click();

      expect(goTo).toHaveBeenCalledWith(null, {
        path: '/ws/Core/Person.cs',
        range: { startLineNumber: 4, startColumn: 9, endLineNumber: 4, endColumn: 9 },
      });
    });

    it('theToggle_showsTheFlatList_whereAProblemInAClosedFileCanStillBeChosen', async () => {
      const host: HTMLElement = await show([problem('/ws/Core/Person.cs', 'one', 4)]);

      // The toggle is a checked row of the strip's "…" menu.
      (component as unknown as { onMenu(id: string): void }).onMenu('problems.group');
      await fixture.whenStable();

      expect(host.querySelector('.tree-row')).toBeNull();
      const row: HTMLButtonElement | null = host.querySelector<HTMLButtonElement>('.problems-row');
      expect(row?.textContent).toContain('Person.cs:4:9');
      // A problem in a file nobody has opened is still a way to it (#1144).
      expect(row?.disabled).toBe(false);
    });
  });

  describe('the strip and the empty view (#1182)', () => {
    /**
     * Builds the panel showing problems, with language servers in the given states.
     * @param problems The problems.
     * @param starting Whether a language server for the workspace is still starting.
     * @param solution Whether the workspace has a solution.
     * @returns Returns the panel's element.
     */
    async function show(
      problems: readonly Diagnostic[],
      starting: boolean = false,
      solution: boolean = true,
      settled: boolean = true,
      analysis: 'pending' | 'done' | undefined = undefined,
    ): Promise<HTMLElement> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ProblemsPanel],
        providers: [
          { provide: ActiveWorkspace, useValue: { rootPath: signal<string | null>('/ws') } },
          {
            provide: SolutionModel,
            useValue: {
              owningProject: (): null => null,
              model: signal<unknown>(solution ? { projects: [] } : null),
              settled: signal<boolean>(settled),
            },
          },
          {
            provide: LspStatus,
            useValue: {
              servers: signal<readonly Partial<LspServer>[]>([
                {
                  sessionId: '/ws::csharp',
                  rootPath: '/ws',
                  state: starting ? 'starting' : 'ready',
                  stalled: false,
                  analysis,
                },
              ]),
            },
          },
        ],
      }).compileComponents();
      TestBed.inject(Diagnostics).register(new StaticProvider(problems));
      fixture = TestBed.createComponent(ProblemsPanel);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('panel', panel);
      await fixture.whenStable();
      return fixture.nativeElement as HTMLElement;
    }

    /**
     * A problem of a severity.
     * @param severity The severity.
     * @returns Returns the problem.
     */
    function of(severity: Diagnostic['severity']): Diagnostic {
      return {
        file: 'A.cs',
        message: severity,
        severity,
        line: 1,
        column: 1,
        source: 'csharp',
        documentId: null,
        path: '/ws/A.cs',
        scope: 'workspace',
      };
    }

    it('eachSeverityHasAToggleWithItsCount_andNoTotalsSitAtTheEnd', async () => {
      const host: HTMLElement = await show([of('error'), of('warning'), of('warning'), of('hint')]);

      const toggles: string[] = [...host.querySelectorAll<HTMLElement>('.problems-filter')].map(
        (toggle: HTMLElement): string => (toggle.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );

      // No count where there is nothing to count.
      expect(toggles).toEqual(['Everything4', 'Errors1', 'Warnings2', 'Info', 'Hints1']);
      expect(host.querySelector('app-panel-toolbar .problems-count')).toBeNull();
      expect(
        host.querySelector('app-panel-toolbar button[aria-label="More Actions"]'),
      ).not.toBeNull();
    });

    it('whileTheSolutionIsAnalysed_saysSo_ratherThanThatNothingIsWrong', async () => {
      const host: HTMLElement = await show([], true);

      expect(host.querySelector('.problems-empty--analyzing')?.textContent).toContain(
        'Analyzing Solution',
      );
      expect(host.querySelector('.problems-empty__ok')).toBeNull();
    });

    it('beforeTheProjectModelIsRead_orBeforeALoadedServersFirstFullReport_isStillAnalysing', async () => {
      expect(
        (await show([], false, true, false)).querySelector('.problems-empty--analyzing'),
      ).not.toBeNull();
      expect(
        (await show([], false, true, true, 'pending')).querySelector('.problems-empty--analyzing'),
      ).not.toBeNull();
      const done: HTMLElement = await show([], false, true, true, 'done');
      expect(done.querySelector('.problems-empty--analyzing')).toBeNull();
      expect(done.querySelector('.problems-empty')?.textContent?.trim()).toBe(
        'No problems found in this solution',
      );
    });

    it('aFilterThatFindsNothing_saysWhatItFoundNoneOf', async () => {
      const host: HTMLElement = await show([of('warning')]);

      [...host.querySelectorAll<HTMLButtonElement>('app-panel-toolbar button')]
        .find((button: HTMLButtonElement): boolean => (button.textContent ?? '').includes('Errors'))
        ?.click();
      await fixture.whenStable();

      expect(host.querySelector('.problems-empty')?.textContent?.trim()).toBe(
        'No errors found in this solution',
      );
    });
  });
});
