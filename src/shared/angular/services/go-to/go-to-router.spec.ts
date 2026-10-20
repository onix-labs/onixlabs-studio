import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import { GoToSymbol, GoToTarget } from './go-to-model';
import { GoToDialog, GoToPresenter, GoToRequest, RenamePromptRequest } from './go-to-presenter';
import { GoToRouter } from './go-to-router';
import { GoToSymbols } from './go-to-symbols';

/**
 * A symbol reader that answers with whatever the test sets, when the test says.
 */
class FakeSymbols {
  public answer: readonly GoToSymbol[] = [];
  public release: () => void = (): void => undefined;

  /**
   * Answers once the test releases the read.
   * @returns Returns the symbols.
   */
  public symbolsFor(): Promise<readonly GoToSymbol[]> {
    return new Promise<readonly GoToSymbol[]>((resolve: (value: readonly GoToSymbol[]) => void) => {
      this.release = (): void => resolve(this.answer);
    });
  }
}

/**
 * Builds an editor over a document of the given length that records where it is sent.
 * @param calls Receives each navigation call, by name.
 * @param lineCount The number of lines in its document.
 * @returns Returns the editor.
 */
function editorOver(calls: string[], lineCount: number = 120): MonacoApi.editor.ICodeEditor {
  const record: (name: string) => () => void = (name: string) => (): void => void calls.push(name);
  return {
    getModel: (): unknown => ({ getLineCount: (): number => lineCount }),
    layout: record('layout'),
    setPosition: record('setPosition'),
    revealPositionInCenter: record('revealPositionInCenter'),
    setSelection: record('setSelection'),
    revealRangeInCenter: record('revealRangeInCenter'),
    focus: record('focus'),
  } as unknown as MonacoApi.editor.ICodeEditor;
}

describe('GoToRouter', () => {
  it('open_handsThePresenterTheEditorTheModeAndTheAttachedInjector', () => {
    const router: GoToRouter = TestBed.inject(GoToRouter);
    const presented: GoToRequest[] = [];
    vi.spyOn(TestBed.inject(GoToPresenter), 'present').mockImplementation(
      (request: GoToRequest): void => void presented.push(request),
    );
    const editor: MonacoApi.editor.ICodeEditor = editorOver([]);
    const injector: Injector = Injector.create({ providers: [] });

    router.attach(editor, { injector });
    router.open(editor, 'symbol');

    expect(presented).toEqual([{ editor, mode: 'symbol', injector }]);
  });

  it('open_onAnEditorNobodyAttached_stillPresents_inTheMainWindow', () => {
    const router: GoToRouter = TestBed.inject(GoToRouter);
    const presented: GoToRequest[] = [];
    vi.spyOn(TestBed.inject(GoToPresenter), 'present').mockImplementation(
      (request: GoToRequest): void => void presented.push(request),
    );
    const editor: MonacoApi.editor.ICodeEditor = editorOver([]);

    const detach: () => void = router.attach(editor, {
      injector: Injector.create({ providers: [] }),
    });
    detach();
    router.open(editor, 'line');

    expect(presented).toEqual([{ editor, mode: 'line', injector: null }]);
  });

  it('promptRename_asksThePresenter_withTheNameAndTheAttachedInjector_andAnswersWithItsName', async () => {
    const router: GoToRouter = TestBed.inject(GoToRouter);
    const prompts: RenamePromptRequest[] = [];
    vi.spyOn(TestBed.inject(GoToPresenter), 'promptRename').mockImplementation(
      (request: RenamePromptRequest): Promise<string | null> => {
        prompts.push(request);
        return Promise.resolve('greeting');
      },
    );
    const editor: MonacoApi.editor.ICodeEditor = editorOver([]);
    const injector: Injector = Injector.create({ providers: [] });
    router.attach(editor, { injector });

    await expect(router.promptRename(editor, 'greet')).resolves.toBe('greeting');
    expect(prompts).toEqual([{ editor, currentName: 'greet', injector }]);
  });
});

describe('GoToPresenter', () => {
  let presenter: GoToPresenter;
  let settings: Settings;
  let symbols: FakeSymbols;
  let overlay: HTMLElement;

  const target: GoToTarget = { line: 42, column: 10 };
  const greet: GoToSymbol = {
    id: 'greet',
    name: 'greet',
    container: 'Greeter',
    icon: Icon.SYMBOL_FUNCTION,
    target: { line: 3, column: 5, endLine: 3, endColumn: 10 },
  };

  beforeEach(() => {
    symbols = new FakeSymbols();
    TestBed.configureTestingModule({ providers: [{ provide: GoToSymbols, useValue: symbols }] });
    presenter = TestBed.inject(GoToPresenter);
    settings = TestBed.inject(Settings);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    presenter.cancel();
  });

  describe('as dialogs', () => {
    beforeEach(() => settings.set('textEditor.goToStyle', 'dialogs'));

    it('goToLine_opensTheLineDialog_withTheDocumentsLength', () => {
      presenter.present({ editor: editorOver([], 250), mode: 'line', injector: null });

      const dialog: GoToDialog | null = presenter.dialog();
      expect(dialog?.mode).toBe('line');
      expect(dialog?.lineCount).toBe(250);
      expect(overlay.querySelector('app-quick-open')).toBeNull();
    });

    it('goToSymbol_fillsTheDialogsSymbols_onceRead', async () => {
      symbols.answer = [greet];
      presenter.present({ editor: editorOver([]), mode: 'symbol', injector: null });

      expect(presenter.dialog()?.symbols()).toBeNull();
      symbols.release();
      await Promise.resolve();
      await Promise.resolve();

      expect(presenter.dialog()?.symbols()).toEqual([greet]);
    });

    it('complete_goesThere_inTheEditorItCameFrom_andCloses', () => {
      const calls: string[] = [];
      presenter.present({ editor: editorOver(calls), mode: 'line', injector: null });

      presenter.complete(target);

      expect(calls).toEqual(['layout', 'setPosition', 'revealPositionInCenter', 'focus']);
      expect(presenter.dialog()).toBeNull();
    });

    it('cancel_closes_andGivesTheEditorFocusBack', () => {
      const calls: string[] = [];
      presenter.present({ editor: editorOver(calls), mode: 'line', injector: null });

      presenter.cancel();

      expect(calls).toEqual(['focus']);
      expect(presenter.dialog()).toBeNull();
    });
  });

  describe('rename (#1015)', () => {
    it('asDialogs_opensTheRenameDialog_withTheName_andAnswersTheNameEntered', async () => {
      settings.set('textEditor.goToStyle', 'dialogs');
      const calls: string[] = [];
      const answer: Promise<string | null> = presenter.promptRename({
        editor: editorOver(calls),
        currentName: 'greet',
        injector: null,
      });

      expect(presenter.dialog()?.mode).toBe('rename');
      expect(presenter.dialog()?.currentName).toBe('greet');
      expect(overlay.querySelector('app-quick-open')).toBeNull();
      presenter.completeRename('greeting');

      await expect(answer).resolves.toBe('greeting');
      expect(presenter.dialog()).toBeNull();
      expect(calls).toEqual(['focus']);
    });

    it('byDefault_opensTheQuickOpenBoxHoldingTheNameSelected', async () => {
      const answer: Promise<string | null> = presenter.promptRename({
        editor: editorOver([]),
        currentName: 'greet',
        injector: null,
      });
      TestBed.tick();

      const field: HTMLInputElement | null = overlay.querySelector('app-quick-open input');
      expect(field?.value).toBe('greet');
      expect(overlay.querySelector('[aria-label="Rename Symbol"]')).not.toBeNull();
      expect(presenter.dialog()).toBeNull();
      presenter.completeRename('greeting');

      await expect(answer).resolves.toBe('greeting');
      expect(overlay.querySelector('app-quick-open')).toBeNull();
    });

    it('cancel_orAnotherGoTo_answersNoName', async () => {
      const cancelled: Promise<string | null> = presenter.promptRename({
        editor: editorOver([]),
        currentName: 'greet',
        injector: null,
      });
      presenter.cancel();
      await expect(cancelled).resolves.toBeNull();

      const replaced: Promise<string | null> = presenter.promptRename({
        editor: editorOver([]),
        currentName: 'greet',
        injector: null,
      });
      presenter.present({ editor: editorOver([]), mode: 'line', injector: null });
      await expect(replaced).resolves.toBeNull();
    });
  });

  describe('as the quick-open box', () => {
    it('opensTheBox_inTheOverlay_andNoDialog', () => {
      presenter.present({ editor: editorOver([]), mode: 'line', injector: null });
      TestBed.tick();

      expect(overlay.querySelector('app-quick-open')).not.toBeNull();
      expect(presenter.dialog()).toBeNull();
    });

    it('isTheDefault_andTheSettingSwitchesItLive', () => {
      presenter.present({ editor: editorOver([]), mode: 'line', injector: null });
      expect(presenter.dialog()).toBeNull();

      settings.set('textEditor.goToStyle', 'dialogs');
      presenter.present({ editor: editorOver([]), mode: 'line', injector: null });

      // Opening the dialog closed the box.
      expect(presenter.dialog()?.mode).toBe('line');
      expect(overlay.querySelector('app-quick-open')).toBeNull();
    });

    it('complete_goesThere_andRemovesTheBox', () => {
      const calls: string[] = [];
      presenter.present({ editor: editorOver(calls), mode: 'symbol', injector: null });
      TestBed.tick();

      presenter.complete(greet.target);

      expect(calls).toEqual(['layout', 'setSelection', 'revealRangeInCenter', 'focus']);
      expect(overlay.querySelector('app-quick-open')).toBeNull();
    });

    it('goToSymbol_handsTheBoxItsSymbols_onceRead', async () => {
      symbols.answer = [greet];
      presenter.present({ editor: editorOver([]), mode: 'symbol', injector: null });
      TestBed.tick();
      expect(overlay.textContent).toContain('Reading');

      symbols.release();
      await Promise.resolve();
      await Promise.resolve();
      TestBed.tick();

      expect(overlay.textContent).toContain('greet');
      expect(overlay.textContent).toContain('Greeter');
    });

    it('anEditorWithNoModel_opensNothing', () => {
      presenter.present({
        editor: { getModel: (): null => null } as unknown as MonacoApi.editor.ICodeEditor,
        mode: 'line',
        injector: null,
      });

      expect(overlay.querySelector('app-quick-open')).toBeNull();
      expect(presenter.dialog()).toBeNull();
    });
  });
});
