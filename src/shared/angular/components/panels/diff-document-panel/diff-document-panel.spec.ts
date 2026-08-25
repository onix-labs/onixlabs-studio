import { DebugElement, signal, Signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
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

describe('DiffDocumentPanel', () => {
  let fixture: ComponentFixture<DiffDocumentPanel>;
  let diffs: Diffs;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiffDocumentPanel],
      providers: [
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
          },
        },
      ],
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

  it('theChangeBadgeSitsOnTheStrip_afterTheCommands', async () => {
    diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'modified'));
    fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
    fixture.detectChanges();
    await fixture.whenStable();

    const badge: HTMLElement | null = host.querySelector<HTMLElement>(
      'app-panel-toolbar .diff__badge',
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('modified');
    expect(badge!.classList).toContain('diff__badge--modified');

    // After the arrows, not before them: it is the strip's one read-only thing.
    const strip: HTMLElement = host.querySelector<HTMLElement>('app-panel-toolbar')!;
    const next: HTMLElement = strip.querySelector<HTMLElement>('[aria-label="Next Change"]')!;
    expect(next.compareDocumentPosition(badge!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('theBadgeIsAbsent_whenNothingIsBeingCompared', async () => {
    fixture.componentRef.setInput('panel', makePanel('diff:src/app/main.ts'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('.diff__badge')).toBeNull();
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

    diffs.put('diff:src/app/main.ts', makeFile('src/app/main.ts', 'added'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('.diff__badge')?.classList).toContain('diff__badge--added');
  });
});
