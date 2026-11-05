import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { MockInstance } from 'vitest';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { Editors } from '@shared/angular/services/editors/editors';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import {
  REFERENCES_HOST,
  ReferenceItem,
  ReferenceList,
  ReferencesHost,
} from '@shared/angular/services/references/reference-list';

import { ChangeMargins } from '../change-margin/change-margins';
import { CodeDocumentEditor } from '../code-document/code-document';
import { CodeRunner } from '../code-runner/code-runner';
import { CodeStatus } from '../code-status/code-status';
import { CodeView } from './code-view';

/**
 * Stands in for the editor pane: records what the view drives it to do.
 */
class FakePane {
  public readonly triggered: string[] = [];
  public readonly ran: string[] = [];
  public readonly reveals: number[] = [];
  public pastes: number = 0;
  public text: string = 'the text';
  public replaced: string[] = [];
  public editor: unknown = {};

  public getEditor(): unknown {
    return this.editor;
  }

  public getModelUri(): string {
    return 'inmemory://model/1';
  }

  public trigger(action: string): void {
    this.triggered.push(action);
  }

  public paste(): void {
    this.pastes += 1;
  }

  public async runAction(action: string): Promise<void> {
    await Promise.resolve();
    this.ran.push(action);
  }

  public getValue(): string {
    return this.text;
  }

  public getSelectionText(): string {
    return 'selected';
  }

  public replaceAll(text: string): void {
    this.replaced.push(text);
  }

  public replaceRange(start: number, length: number, text: string): void {
    this.replaced.push(`${start}:${length}:${text}`);
  }

  public reveal(line: number): void {
    this.reveals.push(line);
  }
}

/**
 * Stands in for the document composition, which would boot Monaco.
 */
@Component({
  selector: 'app-code-document',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: CodeDocumentEditor, useExisting: forwardRef((): unknown => StubCodeDocument) },
  ],
})
class StubCodeDocument {
  public readonly documentId: InputSignal<string> = input.required<string>();
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(true);
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
  public readonly ready: OutputEmitterRef<void> = output<void>();
  public readonly cursorChange: OutputEmitterRef<unknown> = output<unknown>();
  public readonly eolChange: OutputEmitterRef<string> = output<string>();
  public readonly indentationChange: OutputEmitterRef<string> = output<string>();
  public readonly selectionChange: OutputEmitterRef<boolean> = output<boolean>();
  public readonly pane: FakePane = new FakePane();
  public readonly backing: WritableSignal<CodeDocument | null> = signal<CodeDocument | null>(null);

  public document(): CodeDocument | null {
    return this.backing();
  }

  public getPane(): FakePane {
    return this.pane;
  }
}

/**
 * The change margin, with its feeds recorded.
 */
class FakeMargins {
  public readonly baselines: string[] = [];
  public colours: number = 0;
  public detached: number = 0;
  public attached: string[] = [];

  public attach(_editor: unknown, baseline: string): unknown {
    this.attached.push(baseline);
    return {
      setBaseline: (saved: string): void => void this.baselines.push(saved),
      setColors: (): void => {
        this.colours += 1;
      },
    };
  }

  public detach(): void {
    this.detached += 1;
  }

  public resolveColors(): unknown {
    return {};
  }
}

/**
 * The language client, with its calls recorded.
 */
class FakeLsp {
  public readonly synced: { content: string; path: string | null }[] = [];
  public readonly saved: string[] = [];
  public readonly closed: string[] = [];

  public syncDocument(document: { content: string; path: string | null }): void {
    this.synced.push(document);
  }

  public rootForDocument(): string | null {
    return '/fixture';
  }

  public notifySaved(_id: string, content: string): void {
    this.saved.push(content);
  }

  public closeDocument(id: string): void {
    this.closed.push(id);
  }
}

describe('CodeView, around its document', () => {
  let fixture: ComponentFixture<CodeView>;
  let margins: FakeMargins;
  let lsp: FakeLsp;
  let documents: Documents;
  let revealRequest: WritableSignal<unknown>;
  let registered: string[];
  let unregistered: string[];
  let runs: string[][];
  let roots: (string | null)[];
  let cleared: string[];

  /**
   * Gets the stub document.
   */
  function core(): StubCodeDocument {
    const found: StubCodeDocument | undefined = fixture.debugElement.query(
      (element: { componentInstance: unknown }): boolean =>
        element.componentInstance instanceof StubCodeDocument,
    )?.componentInstance as StubCodeDocument | undefined;
    if (found === undefined) {
      throw new Error('The document did not render');
    }
    return found;
  }

  /**
   * Renders the view with a document behind it.
   */
  async function render(
    options: { active?: boolean; removeOnDestroy?: boolean; ready?: boolean } = {},
  ): Promise<void> {
    fixture = TestBed.createComponent(CodeView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('isActive', options.active ?? true);
    fixture.componentRef.setInput('removeOnDestroy', options.removeOnDestroy ?? true);
    fixture.detectChanges();
    core().backing.set(documents.ensure('tab-1'));
    if (options.ready !== false) {
      core().ready.emit();
    }
    await fixture.whenStable();
  }

  beforeEach(() => {
    margins = new FakeMargins();
    lsp = new FakeLsp();
    revealRequest = signal<unknown>(null);
    registered = [];
    unregistered = [];
    runs = [];
    roots = [];
    cleared = [];
    TestBed.overrideComponent(CodeView, {
      remove: { imports: [CodeDocumentEditor] },
      add: { imports: [StubCodeDocument] },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ChangeMargins, useValue: margins },
        { provide: LspClient, useValue: lsp },
        {
          provide: Editors,
          useValue: {
            revealRequest,
            register: (uri: string): void => void registered.push(uri),
            unregister: (uri: string): void => void unregistered.push(uri),
          },
        },
        {
          provide: CodeRunner,
          useValue: {
            run: async (_id: string, language: string, content: string): Promise<void> => {
              runs.push([language, content]);
              return Promise.resolve();
            },
          },
        },
        {
          provide: ActiveWorkspace,
          useValue: {
            setRoot: (_id: string, root: string | null): void => void roots.push(root),
            clearRoot: (id: string): void => void cleared.push(id),
          },
        },
      ],
    });
    documents = TestBed.inject(Documents);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('once the pane is ready', () => {
    it('ready_seedsTheChangeMarginAndRegistersTheEditor', async () => {
      await render();

      expect(margins.attached).toEqual(['']);
      expect(margins.colours).toBeGreaterThan(0);
      expect(registered).toEqual(['inmemory://model/1']);
    });

    it('ready_withoutADocument_doesNothing', async () => {
      fixture = TestBed.createComponent(CodeView);
      fixture.componentRef.setInput('tabId', 'tab-1');
      fixture.detectChanges();

      core().ready.emit();
      await fixture.whenStable();

      expect(margins.attached).toEqual([]);
    });

    it('ready_withoutAnEditor_skipsTheMargin', async () => {
      fixture = TestBed.createComponent(CodeView);
      fixture.componentRef.setInput('tabId', 'tab-1');
      fixture.detectChanges();
      core().backing.set(documents.ensure('tab-1'));
      core().pane.editor = null;

      core().ready.emit();
      await fixture.whenStable();

      expect(margins.attached).toEqual([]);
    });
  });

  describe('commands', () => {
    it('active_registersItsCommands_soTheRibbonDrivesThisPane', async () => {
      await render();
      const commands: EditorCommands = TestBed.inject(EditorCommands);

      commands.cut();
      commands.copy();
      commands.undo();
      commands.redo();
      commands.formatDocument();
      commands.paste();

      expect(core().pane.triggered).toEqual([
        'editor.action.clipboardCutAction',
        'editor.action.clipboardCopyAction',
        'undo',
        'redo',
        'editor.action.formatDocument',
      ]);
      expect(core().pane.pastes).toBe(1);
    });

    it('codeCleanup_formatsOnlyAfterImportsAreOrganised', async () => {
      await render();

      await TestBed.inject(EditorCommands).codeCleanup();

      expect(core().pane.ran).toEqual([
        'editor.action.organizeImports',
        'editor.action.formatDocument',
      ]);
    });

    it('readAndReplace_goThroughThePane', async () => {
      await render();
      const commands: EditorCommands = TestBed.inject(EditorCommands);

      expect(commands.readText('tab-1')).toBe('the text');
      expect(commands.replaceText('tab-1', 'new')).toBe(true);
      expect(commands.replaceRange('tab-1', 1, 2, 'x')).toBe(true);
      expect(commands.readActiveSelection()).toEqual({ tabId: 'tab-1', text: 'selected' });
      expect(core().pane.replaced).toEqual(['new', '1:2:x']);
    });

    it('save_goesToTheActiveDocument', async () => {
      await render();
      const save: MockInstance<Documents['saveActive']> = vi
        .spyOn(documents, 'saveActive')
        .mockResolvedValue(true);
      const saveAs: MockInstance<Documents['saveActiveAs']> = vi
        .spyOn(documents, 'saveActiveAs')
        .mockResolvedValue(true);

      TestBed.inject(EditorCommands).save();
      TestBed.inject(EditorCommands).saveAs();

      expect(save).toHaveBeenCalledOnce();
      expect(saveAs).toHaveBeenCalledOnce();
    });

    it('inactive_handsTheCommandsBack', async () => {
      await render();
      const deactivate: MockInstance<Keybindings['deactivate']> = vi.spyOn(
        TestBed.inject(Keybindings),
        'deactivate',
      );

      fixture.componentRef.setInput('isActive', false);
      await fixture.whenStable();

      expect(deactivate).toHaveBeenCalledWith('tab-1');
      expect(TestBed.inject(EditorCommands).hasActiveEditor()).toBe(false);
    });

    it('inactive_whenReady_registersNothing', async () => {
      await render({ active: false });

      expect(TestBed.inject(EditorCommands).readText('tab-1')).toBeNull();
    });

    it('selection_reachesTheRibbon', async () => {
      await render();

      core().selectionChange.emit(true);

      expect(TestBed.inject(EditorCommands).hasSelection()).toBe(true);
    });

    it('runChord_runsTheDocument', async () => {
      await render();
      const bound: MockInstance<Keybindings['register']> = vi.spyOn(
        TestBed.inject(Keybindings),
        'register',
      );
      fixture.componentRef.setInput('isActive', false);
      await fixture.whenStable();
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
      documents.setContent('tab-1', 'print(1)');

      bound.mock.calls[0]?.[1]
        .find((binding: { id: string }): boolean => binding.id === 'code.run')
        ?.command();

      expect(runs).toEqual([[documents.get('tab-1')?.language(), 'print(1)']]);
    });
  });

  describe('status', () => {
    it('cursor_publishesTheEditorContext', async () => {
      await render();
      const status: CodeStatus = fixture.debugElement.injector.get(CodeStatus);

      core().cursorChange.emit({ line: 4, column: 2 });
      core().eolChange.emit('CRLF');
      core().indentationChange.emit('Spaces: 2');
      await fixture.whenStable();

      expect(status.context()).toMatchObject({
        line: 4,
        column: 2,
        eol: 'CRLF',
        indent: 'Spaces: 2',
      });
    });

    it('beforeACursor_publishesNothing', async () => {
      await render();

      expect(fixture.debugElement.injector.get(CodeStatus).context()).toBeNull();
    });
  });

  describe('the language server', () => {
    it('edits_reachTheServer_andASaveIsAnnounced', async () => {
      await render();

      documents.setContent('tab-1', 'edited');
      await fixture.whenStable();

      expect(lsp.synced.at(-1)?.content).toBe('edited');
      expect(lsp.saved.length).toBeGreaterThan(0);
      expect(roots.at(-1)).toBe('/fixture');
    });

    it('dockedEditor_leavesThePublishedRootToItsWorkspace', async () => {
      await render({ removeOnDestroy: false });

      expect(roots).toEqual([]);
    });
  });

  describe('reveals', () => {
    it('reveal_ofThisDocument_movesThePane', async () => {
      await render();

      revealRequest.set({ documentId: 'tab-1', line: 12, column: 1 });
      await fixture.whenStable();

      expect(core().pane.reveals).toEqual([12]);
    });

    it('reveal_ofAnotherDocument_isLeftAlone', async () => {
      await render();

      revealRequest.set({ documentId: 'other', line: 12, column: 1 });
      await fixture.whenStable();

      expect(core().pane.reveals).toEqual([]);
    });

    it('reveal_askedBeforeThePaneWasReady_landsOnceItIs', async () => {
      revealRequest.set({ documentId: 'tab-1', line: 12, column: 1 });
      await render({ ready: false });
      expect(core().pane.reveals).toEqual([]);

      core().ready.emit();
      await fixture.whenStable();

      expect(core().pane.reveals).toEqual([12]);
    });
  });

  describe('going away', () => {
    it('closing_releasesEverythingTheTabOwned', async () => {
      await render();

      fixture.destroy();

      expect(margins.detached).toBe(1);
      expect(unregistered).toEqual(['inmemory://model/1']);
      expect(lsp.closed).toEqual(['tab-1']);
      expect(cleared).toEqual(['tab-1']);
      expect(TestBed.inject(EditorCommands).readText('tab-1')).toBeNull();
    });

    it('reparenting_aDockedEditor_keepsTheLanguageServerDocumentOpen', async () => {
      await render({ removeOnDestroy: false });

      fixture.destroy();

      expect(unregistered).toEqual(['inmemory://model/1']);
      expect(lsp.closed).toEqual([]);
      expect(cleared).toEqual([]);
    });

    it('closing_beforeThePaneWasReady_doesNotThrow', async () => {
      await render({ ready: false });

      expect((): void => {
        fixture.destroy();
      }).not.toThrow();
      expect(margins.detached).toBe(0);
    });
  });
});

describe('CodeView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeView],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Monaco editor is not booted:
  // Monaco loads its editor over an AMD loader script and browser layout APIs that the jsdom test
  // environment does not provide. This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<CodeView>> =
      TestBed.createComponent(CodeView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('referencesHost_showsTheListBesideTheEditor_goesToAChosenRow_andHidesOnClose', () => {
    // #1014: outside a workspace, the tab answers its editors' Find All References itself.
    const fixture: ReturnType<typeof TestBed.createComponent<CodeView>> =
      TestBed.createComponent(CodeView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const view: CodeView = fixture.componentInstance;
    const protectedView: {
      references: Signal<ReferenceList | null>;
      onReferenceChosen(item: ReferenceItem): void;
      onReferencesClosed(): void;
    } = view as unknown as {
      references: Signal<ReferenceList | null>;
      onReferenceChosen(item: ReferenceItem): void;
      onReferencesClosed(): void;
    };
    const editor: MonacoApi.editor.ICodeEditor = {
      focus: (): void => undefined,
    } as unknown as MonacoApi.editor.ICodeEditor;
    const item: ReferenceItem = {
      path: '/tmp/a.ts',
      range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4 },
      preview: 'foo();',
    };
    const list: ReferenceList = {
      kind: 'references',
      symbol: 'foo',
      status: 'done',
      items: [item],
    };
    const goTo: MockInstance<EditorNavigation['goTo']> = vi
      .spyOn(TestBed.inject(EditorNavigation), 'goTo')
      .mockResolvedValue(undefined);

    expect(fixture.debugElement.injector.get<ReferencesHost>(REFERENCES_HOST)).toBe(view);
    view.openReferences(list, editor);
    expect(protectedView.references()).toBe(list);
    protectedView.onReferenceChosen(item);
    expect(goTo).toHaveBeenCalledWith(editor, item, true);
    protectedView.onReferencesClosed();
    expect(protectedView.references()).toBeNull();
  });
});
