import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  WritableSignal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Documents } from '@shared/angular/services/documents/documents';
import { MergeTools } from '@shared/angular/services/merge-tool/merge-tools';
import {
  CONFLICT_CONTEXT,
  ConflictContext,
} from '@shared/angular/services/repository/conflict-context';
import { ConflictSides } from '@shared/angular/services/repository/conflict-resolution';
import { Icon } from '@shared/angular/icons/icon';
import { MergeToolPanel } from './merge-tool-panel';

/**
 * Describes a whole-line highlight a pane was given.
 */
interface Highlight {
  readonly range: { readonly startLineNumber: number; readonly endLineNumber: number };
  readonly options: { readonly className?: string };
}

/**
 * Stands in for Monaco's editor, which jsdom cannot host: the text it holds, the highlights and rows
 * drawn in it, and where it was scrolled and moved to.
 */
class FakeMonaco {
  /**
   * Holds the highlights last set, per collection.
   */
  public readonly highlights: Highlight[][] = [];

  /**
   * Holds the rows drawn above the conflicts.
   */
  public readonly zones: HTMLElement[] = [];

  /**
   * Holds the line scrolled to the top, by way of its offset (20 pixels a line).
   */
  public scrolledTo: number | null = null;

  /**
   * Holds the line the caret was put on.
   */
  public caret: number | null = null;

  /**
   * Holds the line shown at the top.
   */
  public topLine: number = 1;

  /**
   * Holds the scroll listener.
   */
  public scrolled: ((event: { scrollTopChanged: boolean }) => void) | null = null;

  /**
   * Initializes a new instance of the {@link FakeMonaco} class.
   * @param text Reads the text the pane holds.
   */
  public constructor(private readonly text: () => string) {}

  public getModel(): unknown {
    return {
      getValue: (): string => this.text(),
      getLinesContent: (): string[] => this.text().split('\n'),
      getEOL: (): string => '\n',
    };
  }

  public createDecorationsCollection(): unknown {
    const index: number = this.highlights.length;
    this.highlights.push([]);
    return {
      set: (decorations: Highlight[]): void => {
        this.highlights[index] = decorations;
      },
      clear: (): void => {
        this.highlights[index] = [];
      },
    };
  }

  public onDidChangeModelContent(): unknown {
    return { dispose: (): void => undefined };
  }

  public onDidScrollChange(listener: (event: { scrollTopChanged: boolean }) => void): unknown {
    this.scrolled = listener;
    return { dispose: (): void => undefined };
  }

  public changeViewZones(callback: (accessor: unknown) => void): void {
    callback({
      addZone: (zone: { domNode: HTMLElement }): string => {
        this.zones.push(zone.domNode);
        return `zone-${this.zones.length}`;
      },
      removeZone: (): void => {
        this.zones.splice(0);
      },
    });
  }

  public getVisibleRanges(): unknown[] {
    return [{ startLineNumber: this.topLine }];
  }

  public getTopForLineNumber(line: number): number {
    return line * 20;
  }

  public setScrollTop(top: number): void {
    this.scrolledTo = top / 20;
  }

  public getPosition(): unknown {
    return { lineNumber: this.caret ?? 1 };
  }

  public setPosition(position: { lineNumber: number }): void {
    this.caret = position.lineNumber;
  }

  public revealLineNearTop(line: number): void {
    this.topLine = line;
  }

  public revealLineInCenterIfOutsideViewport(line: number): void {
    this.topLine = line;
  }

  public focus(): void {
    // Nothing to focus in jsdom.
  }

  public pushUndoStop(): boolean {
    return true;
  }

  public executeEdits(): boolean {
    return true;
  }
}

/**
 * Stands in for Studio's text editor, over a {@link FakeMonaco}.
 */
@Component({
  selector: 'app-text-editor',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: TextEditor, useExisting: forwardRef((): unknown => StubTextEditor) }],
})
class StubTextEditor {
  public readonly content: InputSignal<string> = input<string>('');
  public readonly language: InputSignal<string> = input<string>('');
  public readonly options: InputSignal<unknown> = input<unknown>(null);
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);
  public readonly editorConfig: InputSignal<unknown> = input<unknown>(null);
  public readonly ready: OutputEmitterRef<void> = output<void>();
  public readonly contentChange: OutputEmitterRef<string> = output<string>();

  public readonly editor: FakeMonaco = new FakeMonaco((): string => this.content());

  public getEditor(): FakeMonaco {
    return this.editor;
  }
}

/**
 * A file mid-merge: one conflict, with a line either side.
 */
const MERGED: string = [
  'before',
  '<<<<<<< HEAD',
  'mine',
  '=======',
  'theirs 1',
  'theirs 2',
  '>>>>>>> topic',
  'after',
].join('\n');

/**
 * The same file as git writes it with diff3 conflict markers.
 */
const DIFF3: string = [
  'before',
  '<<<<<<< HEAD',
  'mine',
  '||||||| base',
  'original',
  '=======',
  'theirs 1',
  '>>>>>>> topic',
  'after',
].join('\n');

describe('MergeToolPanel', () => {
  const path: string = '/repo/src/app.ts';
  let fixture: ComponentFixture<MergeToolPanel>;
  let host: HTMLElement;
  let documents: Documents;
  let documentId: string;
  let sides: WritableSignal<ConflictSides>;
  let swapped: WritableSignal<boolean>;
  let marked: [readonly string[], boolean | undefined][];
  let saved: string[];

  /**
   * Gets the stub editor of one pane.
   * @param testId The pane's test id.
   * @returns Returns the stub.
   */
  function pane(testId: string): StubTextEditor {
    const found: StubTextEditor | undefined = fixture.debugElement.query(
      (element: { nativeElement: unknown; componentInstance: unknown }): boolean =>
        element.componentInstance instanceof StubTextEditor &&
        element.nativeElement instanceof HTMLElement &&
        element.nativeElement.closest(`[data-testid="${testId}"]`) !== null,
    )?.componentInstance as StubTextEditor | undefined;
    if (found === undefined) {
      throw new Error(`No ${testId} pane`);
    }
    return found;
  }

  /**
   * Gets a strip control by its test id.
   * @param testId The control's test id.
   * @returns Returns its button, or null when it is not drawn.
   */
  function control(testId: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"] button`);
  }

  /**
   * Renders the merge tool over the file, with its panes ready.
   * @param content The file's content.
   */
  async function render(content: string): Promise<void> {
    documentId = documents.createWellDocument({
      path,
      name: 'app.ts',
      content,
    } as Parameters<Documents['createWellDocument']>[0]);
    const tools: MergeTools = TestBed.inject(MergeTools);
    const panelId: string = tools.idForPath(path);
    tools.put(panelId, path);
    const panel: DockPanel = {
      id: panelId,
      title: 'app.ts (Merge)',
      icon: Icon.GIT_MERGE,
      role: 'document',
      component: MergeToolPanel,
    };
    fixture = TestBed.createComponent(MergeToolPanel);
    fixture.componentRef.setInput('panel', panel);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    readyAll();
    await fixture.whenStable();
  }

  /**
   * Has every pane shown report its editor ready.
   */
  function readyAll(): void {
    for (const id of ['merge-tool-yours', 'merge-tool-base-pane', 'merge-tool-theirs']) {
      if (host.querySelector(`[data-testid="${id}"]`) !== null) {
        pane(id).ready.emit();
      }
    }
    pane('merge-tool-result').ready.emit();
  }

  beforeEach(() => {
    sides = signal<ConflictSides>({ yours: 'main', theirs: 'topic' });
    swapped = signal<boolean>(false);
    marked = [];
    saved = [];
    const context: ConflictContext = {
      conflictSides: sides,
      conflictMarkersSwapped: swapped,
      isConflicted: (candidate: string): boolean => candidate === path,
      markResolved: (paths: readonly string[], anyway?: boolean): Promise<{ success: boolean }> => {
        marked.push([paths, anyway]);
        return Promise.resolve({ success: true });
      },
    };
    TestBed.overrideComponent(MergeToolPanel, {
      remove: { imports: [TextEditor] },
      add: { imports: [StubTextEditor] },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: CONFLICT_CONTEXT, useValue: context }],
    });
    documents = TestBed.inject(Documents);
    documents.save = (id: string): Promise<boolean> => {
      saved.push(id);
      return Promise.resolve(true);
    };
  });

  it('putsEachSideNextToTheOther_namedByItsBranch', async () => {
    await render(MERGED);

    expect(host.querySelector('[data-testid="merge-tool-yours"] header')?.textContent).toBe(
      'main (Yours)',
    );
    expect(host.querySelector('[data-testid="merge-tool-theirs"] header')?.textContent).toBe(
      'topic (Theirs)',
    );
    expect(pane('merge-tool-yours').content()).toBe('before\nmine\nafter');
    expect(pane('merge-tool-theirs').content()).toBe('before\ntheirs 1\ntheirs 2\nafter');
    expect(pane('merge-tool-result').content()).toBe(MERGED);
  });

  it('swapsTheSides_inARebase', async () => {
    swapped.set(true);
    await render(MERGED);

    expect(pane('merge-tool-yours').content()).toBe('before\ntheirs 1\ntheirs 2\nafter');
  });

  it('tintsEachSidesSection_inItsPane', async () => {
    await render(MERGED);

    const theirs: Highlight[] = pane('merge-tool-theirs').editor.highlights[0];
    expect(
      theirs.map((highlight: Highlight): [number, number, string | undefined] => [
        highlight.range.startLineNumber,
        highlight.range.endLineNumber,
        highlight.options.className,
      ]),
    ).toEqual([[2, 3, 'conflict-lens__theirs']]);
  });

  it('drawsKeepYoursTheirsAndBoth_aboveTheConflict_inTheFile', async () => {
    await render(MERGED);

    expect(
      pane('merge-tool-result').editor.zones.map((zone: HTMLElement) => zone.textContent),
    ).toEqual(['Keep main (Yours)·Keep topic (Theirs)·Keep Both']);
  });

  it('showsTheCommonAncestor_onlyForADiff3File_andCanHideIt', async () => {
    await render(MERGED);
    expect(host.querySelector('[data-testid="merge-tool-base-pane"]')).toBeNull();
    expect(control('merge-tool-base')).toBeNull();

    fixture.destroy();
    documents.remove(documentId);
    await render(DIFF3);
    expect(pane('merge-tool-base-pane').content()).toBe('before\noriginal\nafter');

    control('merge-tool-base')?.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="merge-tool-base-pane"]')).toBeNull();
  });

  it('countsTheConflictsLeft_andStepsBetweenThemOnlyWhileThereAreAny', async () => {
    await render(MERGED);
    expect(host.querySelector('[data-testid="merge-tool-count"]')?.textContent?.trim()).toBe(
      '1 conflict left',
    );
    expect(control('merge-tool-next')?.disabled).toBe(false);

    documents.setContent(documentId, 'before\nmine\nafter');
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="merge-tool-count"]')?.textContent?.trim()).toBe(
      'No conflicts left',
    );
    expect(control('merge-tool-next')?.disabled).toBe(true);
  });

  it('carriesAnEditOfTheFile_intoItsDocument', async () => {
    await render(MERGED);

    pane('merge-tool-result').contentChange.emit('edited');

    expect(documents.get(documentId)?.content()).toBe('edited');
  });

  it('refusesMarkResolved_whileConflictsAreLeft_andOffersAnyway', async () => {
    await render(MERGED);

    control('merge-tool-mark-resolved')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(marked).toEqual([]);
    control('merge-tool-mark-resolved-anyway')?.click();
    await fixture.whenStable();

    expect(marked).toEqual([[[path], true]]);
  });

  it('savesTheFile_thenMarksItResolved_onceNoConflictIsLeft', async () => {
    await render(MERGED);
    pane('merge-tool-result').contentChange.emit('before\nmine\nafter');
    fixture.detectChanges();

    control('merge-tool-mark-resolved')?.click();
    await fixture.whenStable();

    expect(saved).toEqual([documentId]);
    expect(marked).toEqual([[[path], false]]);
  });

  it('bringsTheConflictItWasAskedFor_intoView', async () => {
    await render(MERGED);

    TestBed.inject(MergeTools).requestReveal(TestBed.inject(MergeTools).idForPath(path), 0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(pane('merge-tool-result').editor.caret).toBe(2);
  });

  it('scrollsTheSidesWithTheFile_lineForLine', async () => {
    await render(MERGED);
    const result: FakeMonaco = pane('merge-tool-result').editor;

    // "after" is line 8 of the file, 3 of Yours and 4 of Theirs.
    result.topLine = 8;
    result.scrolled?.({ scrollTopChanged: true });

    expect(pane('merge-tool-yours').editor.scrolledTo).toBe(3);
    expect(pane('merge-tool-theirs').editor.scrolledTo).toBe(4);
  });

  it('saysSo_whenTheFilesTabHasBeenClosed', async () => {
    await render(MERGED);

    documents.remove(documentId);
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="merge-tool-empty"]')).not.toBeNull();
  });
});
