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
import type * as MonacoApi from 'monaco-editor';

import { TextEditor } from '@shared/angular/components/text-editor';
import { Breakpoints } from '@shared/angular/services/debug/breakpoints';
import { Debugger, DebugLocation } from '@shared/angular/services/debug/debugger';
import { Documents } from '@shared/angular/services/documents/documents';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Printing, PrintPreparer } from '@shared/angular/services/printing/printing';
import { BreakpointGutter } from '../breakpoints/breakpoint-gutter';
import { CodeDocumentEditor } from './code-document';

/**
 * Stands in for the Monaco pane, which jsdom cannot host. It answers the pane's imperative API and
 * exposes its outputs to fire.
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
  public readonly newDocumentEol: InputSignal<unknown> = input<unknown>(null);
  public readonly editorConfig: InputSignal<unknown> = input<unknown>(null);
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
  public readonly ready: OutputEmitterRef<void> = output<void>();
  public readonly contentChange: OutputEmitterRef<string> = output<string>();
  public readonly cursorChange: OutputEmitterRef<unknown> = output<unknown>();
  public readonly eolChange: OutputEmitterRef<unknown> = output<unknown>();
  public readonly indentationChange: OutputEmitterRef<string> = output<string>();
  public readonly selectionChange: OutputEmitterRef<boolean> = output<boolean>();

  public value: string = 'text after the save rules';
  public actions: string[] = [];
  public formatted: unknown[] = [];
  public decorations: unknown[][] = [];
  public decorationClears: number = 0;
  public editor: unknown = {
    createDecorationsCollection: (): unknown => ({
      set: (decorations: unknown[]): void => void this.decorations.push(decorations),
      clear: (): void => {
        this.decorationClears += 1;
      },
    }),
  };

  public getEditor(): unknown {
    return this.editor;
  }

  public getValue(): string {
    return this.value;
  }

  public async runActionForSave(action: string): Promise<void> {
    this.actions.push(action);
    return Promise.resolve();
  }

  public async formatLinesForSave(ranges: unknown): Promise<void> {
    this.formatted.push(ranges);
    return Promise.resolve();
  }
}

/**
 * The gutter service, with the store-driven render recorded.
 */
class FakeGutter {
  public readonly rendered: (readonly { line: number }[])[] = [];
  public toggle: (line: number) => void = (): void => undefined;
  public edit: (line: number) => void = (): void => undefined;
  public detached: number = 0;

  public attach(
    _editor: unknown,
    toggle: (line: number) => void,
    edit: (line: number) => void,
  ): unknown {
    this.toggle = toggle;
    this.edit = edit;
    return {
      render: (breakpoints: readonly { line: number }[]): void =>
        void this.rendered.push(breakpoints),
    };
  }

  public detach(): void {
    this.detached += 1;
  }
}

describe('CodeDocumentEditor, wired to a pane', () => {
  let fixture: ComponentFixture<CodeDocumentEditor>;
  let gutter: FakeGutter;
  let stopped: WritableSignal<DebugLocation | null>;
  let documents: Documents;
  let breakpoints: Breakpoints;
  let documentId: string;
  const path: string = '/fixture/main.ts';

  /**
   * Gets the stub pane.
   */
  function pane(): StubTextEditor {
    const found: StubTextEditor | undefined = fixture.debugElement.query(
      (element: { componentInstance: unknown }): boolean =>
        element.componentInstance instanceof StubTextEditor,
    )?.componentInstance as StubTextEditor | undefined;
    if (found === undefined) {
      throw new Error('The pane did not render');
    }
    return found;
  }

  /**
   * Renders the component over a document with a file.
   */
  async function render(options: { removeOnDestroy?: boolean } = {}): Promise<void> {
    documentId = documents.createWellDocument({
      path,
      name: 'main.ts',
      content: 'const a = 1;\n',
    } as Parameters<Documents['createWellDocument']>[0]);
    fixture = TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', documentId);
    fixture.componentRef.setInput('isActive', true);
    fixture.componentRef.setInput('removeOnDestroy', options.removeOnDestroy ?? true);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Reads the rendered breakpoint editor, if one is showing.
   */
  function breakpointTitle(): string | null {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    return host.querySelector('.breakpoint-editor__title')?.textContent ?? null;
  }

  /**
   * Presses one of the breakpoint editor's buttons.
   */
  async function pressButton(label: string): Promise<void> {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const button: Element | undefined = Array.from(
      host.querySelectorAll('.breakpoint-editor__actions app-button'),
    ).find((element: Element): boolean => element.textContent.includes(label));
    if (!(button instanceof HTMLElement)) {
      throw new Error(`No ${label} button`);
    }
    button.click();
    await fixture.whenStable();
  }

  beforeEach(() => {
    gutter = new FakeGutter();
    stopped = signal<DebugLocation | null>(null);
    TestBed.overrideComponent(CodeDocumentEditor, {
      remove: { imports: [TextEditor] },
      add: { imports: [StubTextEditor] },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: BreakpointGutter, useValue: gutter },
        { provide: Debugger, useValue: { stoppedLocation: stopped } },
      ],
    });
    documents = TestBed.inject(Documents);
    breakpoints = TestBed.inject(Breakpoints);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('active_marksTheDocumentActive_andDestroyLetsItGo', async () => {
      await render();
      expect(documents.activeDocumentId()).toBe(documentId);

      fixture.destroy();

      expect(documents.activeDocumentId()).toBeNull();
      expect(documents.get(documentId)).toBeUndefined();
    });

    it('destroy_ofADockedEditor_keepsTheDocument', async () => {
      await render({ removeOnDestroy: false });

      fixture.destroy();

      expect(documents.get(documentId)).toBeDefined();
    });

    it('destroy_beforeItEverInitialised_doesNotTouchTheDocuments', () => {
      const remove: ReturnType<typeof vi.spyOn> = vi.spyOn(documents, 'remove');
      fixture = TestBed.createComponent(CodeDocumentEditor);
      fixture.componentRef.setInput('documentId', 'never-rendered');

      fixture.destroy();

      expect(remove).not.toHaveBeenCalled();
    });

    it('ready_attachesTheGutter_andDestroyDetachesIt', async () => {
      await render();
      let readied: number = 0;
      fixture.componentInstance.ready.subscribe((): void => {
        readied += 1;
      });

      pane().ready.emit();
      await fixture.whenStable();

      expect(readied).toBe(1);
      expect(gutter.rendered.length).toBeGreaterThan(0);
      fixture.destroy();
      expect(gutter.detached).toBe(1);
    });

    it('ready_withoutAnEditor_stillAnnouncesItself', async () => {
      await render();
      pane().editor = null;
      let readied: number = 0;
      fixture.componentInstance.ready.subscribe((): void => {
        readied += 1;
      });

      pane().ready.emit();

      expect(readied).toBe(1);
      expect(gutter.rendered).toEqual([]);
    });

    it('edits_reachTheDocumentAndThoseListening', async () => {
      await render();
      const seen: string[] = [];
      fixture.componentInstance.contentChange.subscribe((text: string): void => {
        seen.push(text);
      });

      pane().contentChange.emit('const a = 2;\n');

      expect(documents.get(documentId)?.content()).toBe('const a = 2;\n');
      expect(seen).toEqual(['const a = 2;\n']);
    });

    it('viewToggles_overrideTheEditorDefaults', async () => {
      await render();
      documents.get(documentId)?.view.set({ wordWrap: true, minimap: false, lineNumbers: false });
      await fixture.whenStable();

      expect(pane().options()).toMatchObject({
        wordWrap: 'on',
        minimap: { enabled: false },
        lineNumbers: 'off',
        glyphMargin: true,
      });
    });
  });

  describe('the debugger', () => {
    const here: DebugLocation = { path, line: 3 } as DebugLocation;

    it('stop_inThisFile_marksTheLine_andResumingClearsIt', async () => {
      await render();
      pane().ready.emit();
      await fixture.whenStable();

      stopped.set(here);
      await fixture.whenStable();
      expect(pane().decorations.at(-1)).toEqual([
        expect.objectContaining({
          range: expect.objectContaining({ startLineNumber: 3 }) as unknown,
        }),
      ]);

      const clears: number = pane().decorationClears;
      stopped.set(null);
      await fixture.whenStable();
      expect(pane().decorationClears).toBeGreaterThan(clears);
    });

    it('stop_thatLandedBeforeTheEditorWasReady_isMarkedOnceItIs', async () => {
      stopped.set(here);
      await render();

      pane().ready.emit();
      await fixture.whenStable();

      expect(pane().decorations).toHaveLength(1);
    });

    it('stop_inAnotherFile_marksNothingHere', async () => {
      await render();
      pane().ready.emit();
      await fixture.whenStable();

      stopped.set({ path: '/fixture/other.ts', line: 3 } as DebugLocation);
      await fixture.whenStable();

      expect(pane().decorations).toEqual([]);
    });
  });

  describe('breakpoints', () => {
    /**
     * Renders over a ready pane.
     */
    async function ready(): Promise<void> {
      await render();
      pane().ready.emit();
      await fixture.whenStable();
    }

    it('gutterClick_togglesTheBreakpointAndRedraws', async () => {
      await ready();

      gutter.toggle(4);
      await fixture.whenStable();

      expect(
        breakpoints.forPath(path).map((point: { line: number }): number => point.line),
      ).toEqual([4]);
      expect(gutter.rendered.at(-1)).toHaveLength(1);

      gutter.toggle(4);
      expect(breakpoints.forPath(path)).toEqual([]);
    });

    it('gutterClick_inAnUnsavedDocument_doesNothing', async () => {
      fixture = TestBed.createComponent(CodeDocumentEditor);
      fixture.componentRef.setInput('documentId', 'untitled');
      fixture.detectChanges();
      await fixture.whenStable();
      pane().ready.emit();
      await fixture.whenStable();

      gutter.toggle(4);
      gutter.edit(4);
      await fixture.whenStable();

      expect(breakpoints.paths()).toEqual([]);
      expect(breakpointTitle()).toBeNull();
    });

    it('edit_opensTheEditorOnANewBreakpoint', async () => {
      await ready();

      gutter.edit(7);
      await fixture.whenStable();

      expect(breakpointTitle()).toContain('line 7');
      expect(breakpoints.forPath(path)).toHaveLength(1);
    });

    it('edit_showsAnExistingBreakpointsCondition', async () => {
      await ready();
      breakpoints.add(path, 7, { condition: 'count > 3' });

      gutter.edit(7);
      await fixture.whenStable();

      const fields: NodeListOf<HTMLInputElement> = (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll('.breakpoint-editor__field input');
      expect(fields[0]?.value).toBe('count > 3');
    });

    it('save_recordsTheEdit', async () => {
      await ready();
      gutter.edit(7);
      await fixture.whenStable();
      const field: HTMLInputElement | null = (fixture.nativeElement as HTMLElement).querySelector(
        '.breakpoint-editor__field input',
      );
      if (field === null) {
        throw new Error('No condition field');
      }
      field.value = 'ready';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();

      await pressButton('Save');

      expect(breakpoints.forPath(path)[0]?.condition).toBe('ready');
      expect(breakpointTitle()).toBeNull();
    });

    it('remove_deletesTheBreakpoint', async () => {
      await ready();
      gutter.edit(7);
      await fixture.whenStable();

      await pressButton('Remove');

      expect(breakpoints.forPath(path)).toEqual([]);
      expect(breakpointTitle()).toBeNull();
    });

    it('cancel_closesWithoutChanging', async () => {
      await ready();
      gutter.edit(7);
      await fixture.whenStable();

      await pressButton('Cancel');

      expect(breakpoints.forPath(path)).toHaveLength(1);
      expect(breakpointTitle()).toBeNull();
    });

    it('togglingTheLineBeingEdited_closesItsEditor', async () => {
      await ready();
      gutter.edit(7);
      await fixture.whenStable();

      gutter.toggle(7);
      await fixture.whenStable();

      expect(breakpointTitle()).toBeNull();
    });
  });

  describe('saving', () => {
    /**
     * Renders, capturing the preparer the document registered for saves.
     */
    async function preparer(): Promise<(settings: object, saved: string) => Promise<void>> {
      let prepare: (settings: object, saved: string) => Promise<void> = async (): Promise<void> =>
        Promise.resolve();
      vi.spyOn(documents, 'registerSavePreparer').mockImplementation(
        (_id: string, registered: unknown): (() => void) => {
          prepare = registered as typeof prepare;
          return (): void => undefined;
        },
      );
      await render();
      return prepare;
    }

    it('save_organisesThenFormats_inThatOrder', async () => {
      const prepare: (settings: object, saved: string) => Promise<void> = await preparer();

      await prepare({ organiseImportsOnSave: true, formatOnSave: 'whole' }, 'saved');

      expect(pane().actions).toEqual([
        'editor.action.organizeImports',
        'editor.action.formatDocument',
      ]);
    });

    it('save_formattingChangedLines_formatsOnlyThose', async () => {
      const prepare: (settings: object, saved: string) => Promise<void> = await preparer();
      pane().value = 'one\nchanged\n';

      await prepare({ organiseImportsOnSave: false, formatOnSave: 'changed' }, 'one\ntwo\n');

      expect(pane().actions).toEqual([]);
      expect(pane().formatted).toHaveLength(1);
    });

    it('save_withTheRulesOff_leavesTheTextAlone', async () => {
      const prepare: (settings: object, saved: string) => Promise<void> = await preparer();

      await prepare({ organiseImportsOnSave: false, formatOnSave: 'off' }, 'saved');

      expect(pane().actions).toEqual([]);
      expect(pane().formatted).toEqual([]);
    });
  });

  describe('printing', () => {
    /**
     * Renders, capturing the print preparer.
     */
    async function printPreparer(): Promise<PrintPreparer> {
      const preparers: PrintPreparer[] = [];
      vi.spyOn(TestBed.inject(Printing), 'registerPreparer').mockImplementation(
        (preparer: PrintPreparer): (() => void) => {
          preparers.push(preparer);
          return (): void => undefined;
        },
      );
      await render();
      const prepare: PrintPreparer | undefined = preparers[0];
      if (prepare === undefined) {
        throw new Error('No print preparer');
      }
      return prepare;
    }

    /**
     * Reads the print mirror.
     */
    function mirror(): HTMLElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('.code-print');
    }

    it('print_fillsTheMirrorWithTheWholeFile_andEmptiesItAfter', async () => {
      const prepare: PrintPreparer = await printPreparer();
      vi.spyOn(TestBed.inject(Monaco), 'getMonaco').mockReturnValue(undefined);

      const done: (() => void) | void = prepare();

      expect(mirror()?.textContent).toContain('const a = 1;');
      done?.();
      expect(mirror()?.textContent).toBe('');
    });

    it('print_whenColouringFails_stillPrintsTheText', async () => {
      const prepare: PrintPreparer = await printPreparer();
      vi.spyOn(TestBed.inject(Monaco), 'getMonaco').mockReturnValue({
        editor: {
          tokenize: (): never => {
            throw new Error('no grammar');
          },
        },
      } as unknown as typeof MonacoApi);

      prepare();

      expect(mirror()?.textContent).toContain('const a = 1;');
    });
  });
});

describe('CodeDocumentEditor', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeDocumentEditor],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Monaco editor is not booted:
  // the code editor depends on browser layout APIs that the jsdom test environment does not provide.
  // This keeps the smoke test to the component's own wiring. The required document id is set so the
  // component's own lifecycle (which reads it on teardown) has a value.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ComponentFixture<CodeDocumentEditor> =
      TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', 'test-document');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('init_readiesTheDocumentForSaves_untilItIsDestroyed', () => {
    const registered: string[] = [];
    const removed: string[] = [];
    vi.spyOn(TestBed.inject(Documents), 'registerSavePreparer').mockImplementation(
      (id: string): (() => void) => {
        registered.push(id);
        return (): void => void removed.push(id);
      },
    );
    const fixture: ComponentFixture<CodeDocumentEditor> =
      TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', 'test-document');

    fixture.componentInstance.ngOnInit();
    expect(registered).toEqual(['test-document']);

    fixture.destroy();
    expect(removed).toEqual(['test-document']);
  });

  it('print_whenNotTheActiveDocument_leavesThePrintToTheOneThatIs', () => {
    // Every open code document registers to fill its print mirror, but only the active one prints.
    const preparers: PrintPreparer[] = [];
    vi.spyOn(TestBed.inject(Printing), 'registerPreparer').mockImplementation(
      (preparer: PrintPreparer): (() => void) => {
        preparers.push(preparer);
        return (): void => undefined;
      },
    );
    const fixture: ComponentFixture<CodeDocumentEditor> =
      TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', 'test-document');

    expect(preparers.length).toBe(1);
    expect(preparers[0]()).toBeUndefined();
  });

  it('destroy_unregistersThePrintPreparer', () => {
    const unregister: ReturnType<typeof vi.fn<() => void>> = vi.fn<() => void>();
    vi.spyOn(TestBed.inject(Printing), 'registerPreparer').mockReturnValue(unregister);
    const fixture: ComponentFixture<CodeDocumentEditor> =
      TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', 'test-document');

    fixture.destroy();

    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
