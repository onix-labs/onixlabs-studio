import { DebugElement, signal, Signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import {
  GitChangeStatus,
  GitFileChange,
} from '@shared/angular/services/repository/repository-data';
import { Settings, TextEditorSettings } from '@shared/angular/services/settings/settings';
import { ResolvedThemeMode, Theme } from '@shared/angular/services/theme/theme';
import { DiffView } from '../diff-view/diff-view';
import { DiffDocumentPanel } from './diff-document-panel';
import { Repository } from '@shared/angular/services/repository/repository';
import { FileSystem } from '@shared/angular/services/file-system/file-system';

/**
 * The text-editor settings the stubbed {@link Settings} hands out.
 */
const TEXT_EDITOR_SETTINGS: TextEditorSettings = {
  showLineNumbers: true,
  showMinimap: false,
  currentLineHighlight: 'outline',
  colorBrackets: false,
  wordWrap: false,
  stickyScroll: false,
  cursorBlinking: 'blink',
  cursorSmoothCaretAnimation: 'off',
  insertSpaces: true,
  tabSize: 2,
  fontFamily: 'monospace',
  fontSize: 13,
  lineHeight: 1.5,
  braceStyle: 'kr',
};

/**
 * Builds a changed file with embedded diff content.
 * @param path The file path.
 * @param status How the file changed.
 * @returns Returns the file change.
 */
function makeFile(path: string, status: GitChangeStatus): GitFileChange {
  return {
    path,
    status,
    additions: 1,
    deletions: 0,
    language: 'typescript',
    original: 'before',
    modified: 'after',
  };
}

/**
 * Builds the dock panel descriptor whose id names the hosted diff.
 * @param id The diff (dock panel) id.
 * @returns Returns the descriptor.
 */
function makePanel(id: string): DockPanel {
  return {
    id,
    title: 'main.ts',
    icon: Icon.GIT_DIFF,
    role: 'document',
    component: DiffDocumentPanel,
  };
}

/**
 * Gets the providers every case renders the panel with: a Monaco reported as unavailable, so the
 * projected diff view renders in jsdom, and the theme and settings it reads.
 * @returns Returns the providers.
 */
function renderProviders(): unknown[] {
  return [
    // The projected DiffView embeds a Monaco diff editor; reporting the engine as unavailable
    // through its loader seam keeps the panel renderable in jsdom.
    {
      provide: Monaco,
      useValue: {
        ensureLoaded: (): Promise<void> => Promise.resolve(),
        getMonaco: (): undefined => undefined,
        getDiffEditorOptions: (): Record<string, unknown> => ({}),
        getThemeName: (): string => 'studio-dark',
      },
    },
    { provide: Theme, useValue: { resolvedMode: signal<ResolvedThemeMode>('dark') } },
    {
      provide: Settings,
      useValue: {
        globalTextEditor: signal<TextEditorSettings>(TEXT_EDITOR_SETTINGS),
        // The tool strip's button names itself through a tooltip, which reads this.
        value: (): Signal<boolean> => signal<boolean>(true),
        // The panel asks the real DockState whether it is the active tab, and DockState bounds
        // its undo history from here.
        undoStackSize: signal<number>(50),
      },
    },
  ];
}

describe('DiffDocumentPanel', () => {
  let fixture: ComponentFixture<DiffDocumentPanel>;
  let diffs: Diffs;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiffDocumentPanel],
      providers: renderProviders() as never[],
    }).compileComponents();

    diffs = TestBed.inject(Diffs);
    fixture = TestBed.createComponent(DiffDocumentPanel);
    host = fixture.nativeElement as HTMLElement;
  });

  it('file_whenNoDiffIsOpenForThePanelId_rendersNothing', async () => {
    fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('app-diff-view')).toBeNull();
  });

  it('file_whenTheStoreHoldsTheDiff_projectsTheDiffViewForIt', async () => {
    diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
    fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('app-diff-view')).not.toBeNull();
    // The path is not drawn anywhere: the tab carries it, and saying it again cost a whole row.
    expect(host.textContent).not.toContain('src/app/main.ts');
  });

  it('howTheFileChanged_isAChipOnTheStatusStrip_notABadgeOnTheToolStrip', async () => {
    // #882: what the document IS belongs on the status strip.
    const dockState: DockState = TestBed.inject(DockState);
    const well: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
    dockState.tabInto(well!.id, 'diff:src/app/main.ts');
    diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
    fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('app-panel-toolbar')?.textContent).not.toContain('modified');
    expect(TestBed.inject(DocumentStatus).info()?.chip).toEqual({
      text: 'Modified',
      tone: 'warning',
      title: 'How the file changed',
    });
  });

  describe('the well status strip', () => {
    it('publishesNothing_whileThisTabIsNotTheActiveOne', async () => {
      // Every tab in a well stays mounted, so an inactive diff that published would talk over the one
      // actually being looked at.
      diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
      fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(TestBed.inject(DocumentStatus).info()).toBeNull();
    });

    it('publishesTheComparison_onceThisTabIsTheActiveOne', async () => {
      const dockState: DockState = TestBed.inject(DockState);
      const well: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
      dockState.tabInto(well!.id, 'diff:src/app/main.ts');
      diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
      fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
      fixture.detectChanges();
      await fixture.whenStable();

      const info: DocumentStatusInfo | null = TestBed.inject(DocumentStatus).info();
      expect(info).not.toBeNull();
      expect(info!.language).toBe('typescript');
      // Monaco is unavailable in jsdom, so nothing has been diffed — the segments are still published,
      // and answer zero rather than going missing.
      expect(info!.changes).toBe(0);
      expect(info!.currentChange).toBeUndefined();
    });
  });

  describe('the tool strip', () => {
    /**
     * Resolves a tool-strip button by its accessible label.
     * @param label The button's aria-label.
     * @returns Returns the button.
     */
    function tool(label: string): HTMLButtonElement {
      return host.querySelector<HTMLButtonElement>(`app-panel-toolbar [aria-label="${label}"]`)!;
    }

    it('offersBothLayouts_ratherThanAToggleThatHasToBePressedToBeRead', async () => {
      fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
      fixture.detectChanges();
      await fixture.whenStable();

      const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
        'app-panel-toolbar select',
      )!;
      expect(
        Array.from(select.options).map((option: HTMLOptionElement): string => option.value),
      ).toEqual(['side-by-side', 'inline']);
      // Side by side is the standing default, and the control says so without being touched.
      expect(select.value).toBe('side-by-side');
    });

    it('choosingALayout_setsItForEveryOpenDiff', async () => {
      fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
      fixture.detectChanges();
      await fixture.whenStable();
      const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
        'app-panel-toolbar select',
      )!;

      select.value = 'inline';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(diffs.inlineDiff()).toBe(true);

      // Choosing the same layout again leaves it alone rather than flipping back, which a toggle
      // behind a two-choice control would have done.
      select.value = 'inline';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(diffs.inlineDiff()).toBe(true);
    });

    it('theNavigationArrowsAreInert_untilThereIsAComparison', async () => {
      fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(tool('Previous Change').disabled).toBe(true);
      expect(tool('Next Change').disabled).toBe(true);

      diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(tool('Previous Change').disabled).toBe(false);
      expect(tool('Next Change').disabled).toBe(false);
    });

    it('theArrowsAskTheDiffView_whichAsksMonaco', async () => {
      diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
      fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
      fixture.detectChanges();
      await fixture.whenStable();

      // Monaco is unavailable in jsdom, so the view has no editor to forward to. Pressing the arrows
      // must still be harmless — the point is that the panel reaches the view rather than reaching
      // for the editor itself.
      const targets: string[] = [];
      const view: DiffView = fixture.debugElement.query(
        (candidate: DebugElement): boolean => candidate.name === 'app-diff-view',
      ).componentInstance as DiffView;
      view.goToDiff = (target: 'next' | 'previous'): void => {
        targets.push(target);
      };

      tool('Next Change').click();
      tool('Previous Change').click();

      expect(targets).toEqual(['next', 'previous']);
    });
  });

  it('file_whenTheStoreReplacesTheEntry_updatesTheProjectedDiff', async () => {
    diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
    fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
    fixture.detectChanges();
    await fixture.whenStable();

    diffs.put('diff:src/app/main.ts', {
      ...makeFile('src/app/main.ts', 'added'),
      modified: 'later',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const view: DiffView = fixture.debugElement.query(By.directive(DiffView))
      .componentInstance as DiffView;
    expect(view.modified()).toBe('later');
  });
});

describe("DiffDocumentPanel — the change's commands (#882)", () => {
  let fixture: ComponentFixture<DiffDocumentPanel>;
  let diffs: Diffs;
  let host: HTMLElement;
  let calls: string[];
  let staged: ReturnType<typeof signal<readonly GitFileChange[]>>;
  let unstaged: ReturnType<typeof signal<readonly GitFileChange[]>>;
  let confirmed: boolean;

  /**
   * Builds a working-tree change.
   * @param isStaged Whether it is the index's change rather than the working tree's.
   * @returns Returns the change.
   */
  function working(isStaged: boolean): GitFileChange {
    return {
      ...makeFile('src/main.ts', 'modified'),
      target: { kind: 'working', staged: isStaged },
    };
  }

  beforeEach(async () => {
    calls = [];
    confirmed = true;
    staged = signal<readonly GitFileChange[]>([]);
    unstaged = signal<readonly GitFileChange[]>([]);
    const succeed: (name: string) => () => Promise<{ success: boolean }> =
      (name: string): (() => Promise<{ success: boolean }>) =>
      (): Promise<{
        success: boolean;
      }> => {
        calls.push(name);
        return Promise.resolve({ success: true });
      };
    await TestBed.configureTestingModule({
      imports: [DiffDocumentPanel],
      providers: [
        ...(renderProviders() as never[]),
        {
          provide: Repository,
          useValue: {
            info: signal({ root: '/repo', name: 'repo' }),
            staged,
            unstaged,
            stage: (file: GitFileChange): Promise<{ success: boolean }> => {
              staged.set([{ ...file, target: { kind: 'working', staged: true } }]);
              unstaged.set([]);
              return succeed('stage')();
            },
            unstage: succeed('unstage'),
            discard: succeed('discard'),
            loadDiff: (): Promise<{ original: string; modified: string }> =>
              Promise.resolve({ original: 'a', modified: 'b' }),
          },
        },
        {
          provide: FileSystem,
          useValue: {
            confirmDestructive: (): Promise<boolean> => Promise.resolve(confirmed),
          },
        },
      ],
    }).compileComponents();
    diffs = TestBed.inject(Diffs);
    fixture = TestBed.createComponent(DiffDocumentPanel);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Shows a change in the panel.
   * @param change The change.
   */
  async function show(change: GitFileChange): Promise<void> {
    diffs.put('diff:src/main.ts', change);
    fixture.componentRef.setInput('panel', makePanel('diff:src/main.ts'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Finds a strip button by its accessible name.
   * @param label The name.
   * @returns Returns the button, or null.
   */
  function button(label: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`app-panel-toolbar button[aria-label="${label}"]`);
  }

  it('aCommitsChange_offersOpenFile_butNeitherStageNorDiscard', async () => {
    await show({
      ...makeFile('src/main.ts', 'modified'),
      target: { kind: 'commit', hash: 'abc', parent: null },
    });

    expect(button('Open File')?.disabled).toBe(false);
    expect(button('Stage')).toBeNull();
    expect(button('Discard Changes')).toBeNull();
    expect(button('More Actions')).not.toBeNull();
  });

  it('stage_stagesTheChange_andTheDiffThenShowsItStaged', async () => {
    await show(working(false));
    expect(button('Discard Changes')?.disabled).toBe(false);

    button('Stage')?.click();
    await fixture.whenStable();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();

    expect(calls).toEqual(['stage']);
    expect(button('Unstage')).not.toBeNull();
    // A staged change is unstaged before it can be discarded.
    expect(button('Discard Changes')?.disabled).toBe(true);
  });

  it('discard_asksFirst_thenDiscards_andClosesTheDiff', async () => {
    await show(working(false));
    const close: ReturnType<typeof vi.spyOn> = vi
      .spyOn(TestBed.inject(DockState), 'removeFromLayout')
      .mockImplementation((): void => undefined);

    confirmed = false;
    button('Discard Changes')?.click();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    expect(calls).toEqual([]);

    confirmed = true;
    button('Discard Changes')?.click();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(calls).toEqual(['discard']);
    expect(close).toHaveBeenCalledWith('diff:src/main.ts');
  });

  it('theMenu_offersTheFilesCommands_forItsPathInTheRepository', async () => {
    await show(working(false));
    const items: { label: string; disabled?: boolean }[] = (
      fixture.componentInstance as unknown as {
        menuItems(): { label: string; disabled?: boolean }[];
      }
    ).menuItems();

    expect(items.map((item: { label: string }): string => item.label)).toEqual([
      'Copy Path',
      'Select in File Explorer',
      'Open in File System',
    ]);
    expect(items[0].disabled).toBe(false);
  });
});
