import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { history, undoDepth } from '@milkdown/kit/prose/history';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import type { Selection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { MockInstance } from 'vitest';

import { MarkdownDocument } from '@features/markdown/angular/markdown-document/markdown-document';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { Review } from '@features/markdown/angular/markdown-review/markdown-review';
import { MarkdownStatus } from '@features/markdown/angular/markdown-status/markdown-status';
import { Documents } from '@shared/angular/services/documents/documents';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { MarkdownCommands } from '@shared/angular/services/markdown-commands/markdown-commands';
import { MarkdownView } from './markdown-view';

/**
 * The smallest schema a selection needs.
 */
const schema: Schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
});

/**
 * A view as far as the markdown view reads one.
 */
interface StateHolder {
  state: EditorState;
}

/**
 * Stands in for the document composition, which would boot Crepe: a pane over a real editor state.
 */
@Component({
  selector: 'app-markdown-document',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: MarkdownDocument, useExisting: forwardRef((): unknown => StubMarkdownDocument) },
  ],
})
class StubMarkdownDocument {
  public readonly documentId: InputSignal<string> = input.required<string>();
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
  public readonly ready: OutputEmitterRef<void> = output<void>();
  public readonly contentChange: OutputEmitterRef<void> = output<void>();
  public readonly selectionChange: OutputEmitterRef<Selection> = output<Selection>();
  public readonly scroller: HTMLElement = document.createElement('div');
  public readonly state: EditorState = EditorState.create({
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('one two')]),
      schema.node('paragraph', null, [schema.text('three')]),
    ]),
    plugins: [history()],
  });

  public view: StateHolder | null = { state: this.state };

  public getPane(): unknown {
    return {
      getEditorView: (): EditorView | null => this.view as unknown as EditorView | null,
      getScrollContainer: (): HTMLElement => this.scroller,
    };
  }
}

describe('MarkdownView, around its document', () => {
  let fixture: ComponentFixture<MarkdownView>;

  /**
   * Gets the stub document.
   */
  function core(): StubMarkdownDocument {
    const found: unknown = fixture.debugElement.query(
      (element: { componentInstance: unknown }): boolean =>
        element.componentInstance instanceof StubMarkdownDocument,
    )?.componentInstance;
    if (!(found instanceof StubMarkdownDocument)) {
      throw new Error('The document did not render');
    }
    return found;
  }

  /**
   * Renders the view.
   */
  async function render(active: boolean = true, ready: boolean = true): Promise<void> {
    fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('isActive', active);
    fixture.detectChanges();
    if (ready) {
      core().ready.emit();
    }
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.overrideComponent(MarkdownView, {
      remove: { imports: [MarkdownDocument] },
      add: { imports: [StubMarkdownDocument] },
    });
    TestBed.inject(Documents).ensure('tab-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('commands', () => {
    it('ready_whileActive_handsTheRibbonToThisDocument', async () => {
      await render();

      expect(TestBed.inject(MarkdownCommands).hasActiveEditor()).toBe(true);
    });

    it('ready_whileInactive_registersNothing', async () => {
      await render(false);

      expect(TestBed.inject(MarkdownCommands).hasActiveEditor()).toBe(false);
    });

    it('losingActivation_handsTheRibbonBack', async () => {
      await render();
      const deactivate: MockInstance<Keybindings['deactivate']> = vi.spyOn(
        TestBed.inject(Keybindings),
        'deactivate',
      );

      fixture.componentRef.setInput('isActive', false);
      await fixture.whenStable();

      expect(TestBed.inject(MarkdownCommands).hasActiveEditor()).toBe(false);
      expect(deactivate).toHaveBeenCalledWith('tab-1');
    });

    it('activation_beforeThePaneIsReady_waitsForIt', async () => {
      await render(true, false);
      expect(TestBed.inject(MarkdownCommands).hasActiveEditor()).toBe(false);

      core().ready.emit();
      await fixture.whenStable();

      expect(TestBed.inject(MarkdownCommands).hasActiveEditor()).toBe(true);
    });

    it('keybindings_toggleFindAndSaveAs', async () => {
      const bound: MockInstance<Keybindings['register']> = vi.spyOn(
        TestBed.inject(Keybindings),
        'register',
      );
      const toggle: MockInstance<MarkdownPanels['toggle']> = vi.spyOn(
        TestBed.inject(MarkdownPanels),
        'toggle',
      );
      const saveAs: MockInstance<Documents['saveActiveAs']> = vi
        .spyOn(TestBed.inject(Documents), 'saveActiveAs')
        .mockResolvedValue(true);
      await render();

      for (const binding of bound.mock.calls[0]?.[1] ?? []) {
        binding.command();
      }

      expect(toggle).toHaveBeenCalledWith('find');
      expect(saveAs).toHaveBeenCalledOnce();
    });
  });

  describe('editing', () => {
    it('contentChange_refreshesTheHistoryStateAndTellsTheReview', async () => {
      await render();
      const notify: MockInstance<Review['notifySourceChanged']> = vi.spyOn(
        TestBed.inject(Review),
        'notifySourceChanged',
      );
      const edited: EditorState = core().state.apply(core().state.tr.insertText('edit ', 1));
      core().view = { state: edited };
      expect(undoDepth(edited)).toBe(1);

      core().contentChange.emit();

      expect(TestBed.inject(MarkdownCommands).canUndo()).toBe(true);
      expect(notify).toHaveBeenCalledOnce();
    });

    it('contentChange_whileInactive_isIgnored', async () => {
      await render(false);
      const notify: MockInstance<Review['notifySourceChanged']> = vi.spyOn(
        TestBed.inject(Review),
        'notifySourceChanged',
      );

      core().contentChange.emit();

      expect(notify).not.toHaveBeenCalled();
    });

    it('historyRead_duringTheFirstLoad_doesNotReachTheTransaction', async () => {
      await render(true, false);
      // A state without the history plugin, as during the initial content transaction.
      core().view = { state: EditorState.create({ schema }) };

      core().ready.emit();
      await fixture.whenStable();

      expect(TestBed.inject(MarkdownCommands).canUndo()).toBe(false);
    });

    it('recreatedEditor_refreshesItsDerivedState', async () => {
      await render();
      const notify: MockInstance<Review['notifySourceChanged']> = vi.spyOn(
        TestBed.inject(Review),
        'notifySourceChanged',
      );

      core().ready.emit();

      expect(notify).toHaveBeenCalledOnce();
    });
  });

  describe('status', () => {
    /**
     * Reads what the status strip would show.
     */
    function published(): unknown {
      return fixture.debugElement.injector.get(MarkdownStatus).context();
    }

    it('beforeThePaneIsReady_publishesNothing', async () => {
      await render(true, false);

      expect(published()).toBeNull();
    });

    it('ready_publishesTheTextTheEditorShows', async () => {
      await render();

      expect(published()).toMatchObject({ text: 'one two\nthree', selectedText: null });
    });

    it('selection_publishesTheSelectedText', async () => {
      await render();

      core().selectionChange.emit(TextSelection.create(core().state.doc, 1, 4));

      expect(published()).toMatchObject({ selectedText: 'one' });
    });

    it('selection_whileInactive_stillCounts_butLeavesTheRibbonAlone', async () => {
      await render(false);
      const setBlock: MockInstance<MarkdownCommands['setActiveBlockType']> = vi.spyOn(
        TestBed.inject(MarkdownCommands),
        'setActiveBlockType',
      );

      core().selectionChange.emit(TextSelection.create(core().state.doc, 1, 4));

      expect(published()).toMatchObject({ selectedText: 'one' });
      expect(setBlock).not.toHaveBeenCalled();
    });

    it('withoutAnEditorDocument_fallsBackToTheSource', async () => {
      await render(true, false);
      core().view = null;
      TestBed.inject(Documents).setContent('tab-1', '# source');

      core().ready.emit();
      await fixture.whenStable();

      expect(published()).toMatchObject({ text: '# source' });
    });
  });

  describe('going away', () => {
    it('destroy_forgetsTheCommandsAndThePanelState', async () => {
      await render();
      const remove: MockInstance<MarkdownPanels['remove']> = vi.spyOn(
        TestBed.inject(MarkdownPanels),
        'remove',
      );

      fixture.destroy();

      expect(TestBed.inject(MarkdownCommands).hasActiveEditor()).toBe(false);
      expect(remove).toHaveBeenCalledWith('tab-1');
    });

    it('destroy_beforeThePaneWasReady_doesNotThrow', async () => {
      await render(true, false);

      expect((): void => {
        fixture.destroy();
      }).not.toThrow();
    });
  });

  describe('agent panel', () => {
    it('agentPanel_staysMountedOnceOpened', async () => {
      await render();
      const panels: MarkdownPanels = TestBed.inject(MarkdownPanels);
      const host: HTMLElement = fixture.nativeElement as HTMLElement;

      panels.toggle('agent');
      await fixture.whenStable();
      expect(host.querySelector('app-markdown-agent-panel')).not.toBeNull();

      panels.toggle('agent');
      await fixture.whenStable();

      expect(host.querySelector('app-markdown-agent-panel')).not.toBeNull();
    });
  });
});
