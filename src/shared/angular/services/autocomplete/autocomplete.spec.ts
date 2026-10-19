import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import type {
  ParameterHintsControl,
  SuggestAcceptance,
  SuggestControl,
  SuggestItem,
} from '@shared/angular/services/monaco/monaco-suggest-commands';
import { Autocomplete } from './autocomplete';

/**
 * Builds a fake editor in the main window.
 * @param ownerDocument The document its container is in.
 * @returns Returns the editor.
 */
function fakeEditor(ownerDocument: Document = document): MonacoApi.editor.ICodeEditor {
  const none: () => MonacoApi.IDisposable = (): MonacoApi.IDisposable => ({
    dispose: (): void => undefined,
  });
  const container: HTMLElement = ownerDocument.createElement('div');
  ownerDocument.body.appendChild(container);
  // A laid-out editor: the page under test lays nothing out.
  container.getBoundingClientRect = (): DOMRect =>
    ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }) as DOMRect;
  return {
    createContextKey: () => ({ set: (): void => undefined }),
    onDidCompositionStart: none,
    onDidCompositionEnd: none,
    onDidScrollChange: none,
    onDidLayoutChange: none,
    onDidChangeCursorPosition: none,
    onWillType: none,
    getPosition: () => ({ lineNumber: 1, column: 3 }),
    getModel: () => ({
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 3, word: 'ab' }),
      getLanguageId: (): string => 'typescript',
    }),
    getScrolledVisiblePosition: () => ({ top: 0, left: 40, height: 18 }),
    getContainerDomNode: (): HTMLElement => container,
    getOption: (): boolean => true,
  } as unknown as MonacoApi.editor.ICodeEditor;
}

/**
 * Builds a completion.
 * @param label The label.
 * @returns Returns the completion.
 */
function item(label: string): SuggestItem {
  return {
    completion: { label, kind: 0, insertText: label } as MonacoApi.languages.CompletionItem,
    textLabel: label,
    score: [0, 0],
    provider: {},
    isResolved: true,
    resolve: (): Promise<void> => Promise.resolve(),
  };
}

/**
 * Waits for the next frames to have run.
 * @returns Returns a promise that resolves once they have.
 */
function frames(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    requestAnimationFrame((): void => void requestAnimationFrame((): void => resolve()));
  });
}

describe('Autocomplete (#1021)', () => {
  let autocomplete: Autocomplete;
  let assist: unknown;
  const inserted: [string, SuggestAcceptance][] = [];
  const control: SuggestControl = {
    active: true,
    insert: (value: SuggestItem, how: SuggestAcceptance): void =>
      void inserted.push([value.textLabel, how]),
    cancel: (): void => undefined,
    focused: (): void => undefined,
  };

  beforeEach(() => {
    inserted.length = 0;
    assist = null;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Monaco,
          useValue: { useAssist: (value: unknown): void => void (assist = value) },
        },
      ],
    });
    autocomplete = TestBed.inject(Autocomplete);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handsItselfToMonacosTakeover_asItIsMade', () => {
    expect(assist).toBe(autocomplete);
  });

  it('drawsAnEditorsList_inAnOverlay_withNoMonacoWidget', async () => {
    const editor: MonacoApi.editor.ICodeEditor = fakeEditor();
    autocomplete.attach(editor, TestBed.inject(Injector));

    autocomplete.suggestions(editor, control, {
      items: [item('alpha'), item('beta')],
      selected: undefined,
      frozen: false,
      auto: true,
      noFocus: false,
    });
    await frames();

    expect(autocomplete.showing(editor)).toBe(true);
    const overlay: Element | null = document.querySelector('.completion-list-overlay');
    expect(overlay?.querySelectorAll('.completion-list__row')).toHaveLength(2);
    expect(document.querySelector('.suggest-widget, .parameter-hints-widget')).toBeNull();
  });

  it('acceptsAndMoves_thePresentersFocus', () => {
    const editor: MonacoApi.editor.ICodeEditor = fakeEditor();
    autocomplete.attach(editor, TestBed.inject(Injector));
    autocomplete.suggestions(editor, control, {
      items: [item('alpha'), item('beta')],
      selected: undefined,
      frozen: false,
      auto: true,
      noFocus: false,
    });

    autocomplete.move(editor, 'next');
    expect(autocomplete.focusedItem(editor)?.textLabel).toBe('beta');
    autocomplete.accept(editor);

    expect(inserted).toEqual([['beta', 'select']]);
    // The fake session never ends on its own; nothing is left to draw after the spec.
    autocomplete.hidden(editor);
  });

  it('hidden_takesTheListAway', async () => {
    const editor: MonacoApi.editor.ICodeEditor = fakeEditor();
    autocomplete.attach(editor, TestBed.inject(Injector));
    autocomplete.suggestions(editor, control, {
      items: [item('alpha')],
      selected: undefined,
      frozen: false,
      auto: true,
      noFocus: false,
    });
    await frames();

    autocomplete.hidden(editor);

    expect(autocomplete.showing(editor)).toBe(false);
    expect(document.querySelector('.completion-list__row')).toBeNull();
  });

  it('drawsAnEditorsSignatureCard_andDetachingTakesItAway', async () => {
    const editor: MonacoApi.editor.ICodeEditor = fakeEditor();
    const detach: () => void = autocomplete.attach(editor, TestBed.inject(Injector));
    const hints: ParameterHintsControl = {
      next: (): void => undefined,
      previous: (): void => undefined,
      cancel: (): void => undefined,
    };

    autocomplete.showSignatures(editor, hints, {
      signatures: [{ label: 'f(a)', parameters: [{ label: 'a' }] }],
      activeSignature: 0,
      activeParameter: 0,
    });
    await frames();
    expect(
      document.querySelector('.signature-card-overlay .signature-card__parameter')?.textContent,
    ).toBe('a');

    detach();

    expect(autocomplete.showing(editor)).toBe(false);
    expect(document.querySelector('.signature-card-overlay app-signature-card')).toBeNull();
  });

  it('drawsForAnUnattachedEditor_inTheMainWindow_butNotInAnother', () => {
    const main: MonacoApi.editor.ICodeEditor = fakeEditor();
    const other: MonacoApi.editor.ICodeEditor = fakeEditor(
      document.implementation.createHTMLDocument('child'),
    );
    const list: {
      items: SuggestItem[];
      selected: undefined;
      frozen: boolean;
      auto: boolean;
      noFocus: boolean;
    } = { items: [item('alpha')], selected: undefined, frozen: false, auto: true, noFocus: false };

    autocomplete.suggestions(main, control, list);
    autocomplete.suggestions(other, control, list);

    expect(autocomplete.showing(main)).toBe(true);
    expect(autocomplete.showing(other)).toBe(false);
    autocomplete.hidden(main);
  });
});
