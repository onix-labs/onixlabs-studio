import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import type { GoToSymbol, GoToTarget } from '@shared/angular/services/go-to/go-to-model';
import { GoToPresenter } from '@shared/angular/services/go-to/go-to-presenter';
import { GoToSymbols } from '@shared/angular/services/go-to/go-to-symbols';
import { Settings } from '@shared/angular/services/settings/settings';
import { GoToDialogHost } from './go-to-dialog-host';
import { GoToLineModal } from './go-to-line-modal';
import { GoToSymbolModal } from './go-to-symbol-modal';
import { RenameConfirmModal } from './rename-confirm-modal';
import { RenameSymbolModal } from './rename-symbol-modal';
import { RenameConfirmation } from '@shared/angular/services/rename/rename-confirmation';

/**
 * Builds a symbol on the given line.
 * @param name The name.
 * @param line The line, one-based.
 * @returns Returns the symbol.
 */
function symbol(name: string, line: number): GoToSymbol {
  return {
    id: `${name}@${line}`,
    name,
    container: 'Greeter',
    icon: Icon.SYMBOL_FUNCTION,
    target: { line, column: 3 },
  };
}

describe('Go to dialogs', () => {
  let windows: FakeModalWindows;

  beforeEach(() => {
    windows = new FakeModalWindows();
    TestBed.configureTestingModule({ providers: [{ provide: ModalWindows, useValue: windows }] });
  });

  /**
   * Flushes change detection through the modal window's attached view.
   * @returns Returns the modal window's content host.
   */
  function flush(): HTMLElement {
    TestBed.inject(ApplicationRef).tick();
    return windows.contentHost!;
  }

  /**
   * Types into the dialog's field.
   * @param host The dialog's content host.
   * @param text What to type.
   */
  function type(host: HTMLElement, text: string): void {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>('app-text-field input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  /**
   * Presses a key in the dialog's field.
   * @param host The dialog's content host.
   * @param key The key.
   */
  function press(host: HTMLElement, key: string): void {
    host
      .querySelector<HTMLInputElement>('app-text-field input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  /**
   * Finds one of the dialog's buttons by its label.
   * @param host The dialog's content host.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(host: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    )!;
  }

  describe('GoToLineModal', () => {
    let fixture: ComponentFixture<GoToLineModal>;
    let picked: GoToTarget[];

    beforeEach(() => {
      fixture = TestBed.createComponent(GoToLineModal);
      fixture.componentRef.setInput('open', true);
      fixture.componentRef.setInput('lineCount', 80);
      picked = [];
      fixture.componentInstance.picked.subscribe((target: GoToTarget): number =>
        picked.push(target),
      );
      fixture.detectChanges();
    });

    it('namesTheRange_andOffersGoOnlyForALineInIt', () => {
      let host: HTMLElement = flush();
      expect(host.querySelector('.go-to-dialog__hint')?.textContent?.trim()).toBe(
        'Go to line 1–80',
      );
      expect(button(host, 'Go').disabled).toBe(true);

      type(host, '81');
      host = flush();
      expect(host.querySelector('.go-to-dialog__hint--invalid')).not.toBeNull();
      expect(button(host, 'Go').disabled).toBe(true);

      type(host, '12:4');
      host = flush();
      expect(button(host, 'Go').disabled).toBe(false);
      button(host, 'Go').click();

      expect(picked).toEqual([{ line: 12, column: 4 }]);
    });

    it('enter_goes', () => {
      const host: HTMLElement = flush();
      type(host, '7');
      flush();

      press(host, 'Enter');

      expect(picked).toEqual([{ line: 7, column: 1 }]);
    });

    it('cancel_dismisses', () => {
      let dismissed: number = 0;
      fixture.componentInstance.dismissed.subscribe((): number => (dismissed += 1));

      button(flush(), 'Cancel').click();

      expect(dismissed).toBe(1);
    });
  });

  describe('GoToSymbolModal', () => {
    let fixture: ComponentFixture<GoToSymbolModal>;
    let picked: GoToTarget[];
    const symbols: readonly GoToSymbol[] = [symbol('greet', 3), symbol('render', 9)];

    beforeEach(() => {
      fixture = TestBed.createComponent(GoToSymbolModal);
      fixture.componentRef.setInput('open', true);
      fixture.componentRef.setInput('symbols', symbols);
      picked = [];
      fixture.componentInstance.picked.subscribe((target: GoToTarget): number =>
        picked.push(target),
      );
      fixture.detectChanges();
    });

    it('listsTheSymbols_filtersThem_andGoesToTheSelectedOne', () => {
      let host: HTMLElement = flush();
      expect(host.querySelectorAll('.list-row').length).toBe(2);

      type(host, 'ren');
      host = flush();
      expect(host.querySelectorAll('.list-row').length).toBe(1);
      button(host, 'Go').click();

      expect(picked).toEqual([{ line: 9, column: 3 }]);
    });

    it('arrowsMoveTheSelection_andEnterGoes', () => {
      const host: HTMLElement = flush();

      press(host, 'ArrowDown');
      flush();
      press(host, 'Enter');

      expect(picked).toEqual([{ line: 9, column: 3 }]);
    });

    it('clickingASymbol_goesToIt', () => {
      flush().querySelectorAll<HTMLElement>('.list-row')[0].click();

      expect(picked).toEqual([{ line: 3, column: 3 }]);
    });

    it('whileTheSymbolsAreRead_saysSo_andOffersNothingToGoTo', () => {
      fixture.componentRef.setInput('symbols', null);
      fixture.detectChanges();
      const host: HTMLElement = flush();

      expect(host.textContent).toContain('Reading');
      expect(button(host, 'Go').disabled).toBe(true);
    });
  });

  describe('RenameSymbolModal (#1015)', () => {
    let fixture: ComponentFixture<RenameSymbolModal>;
    let renamed: string[];

    beforeEach(() => {
      fixture = TestBed.createComponent(RenameSymbolModal);
      fixture.componentRef.setInput('open', true);
      fixture.componentRef.setInput('currentName', 'greet');
      renamed = [];
      fixture.componentInstance.renamed.subscribe((name: string): number => renamed.push(name));
      fixture.detectChanges();
    });

    it('opensHoldingTheName_andOffersRenameOnlyForANewOne', () => {
      let host: HTMLElement = flush();
      expect(host.querySelector<HTMLInputElement>('app-text-field input')?.value).toBe('greet');
      expect(button(host, 'Rename').disabled).toBe(true);

      type(host, 'greeting');
      host = flush();
      expect(button(host, 'Rename').disabled).toBe(false);
      button(host, 'Rename').click();

      expect(renamed).toEqual(['greeting']);
    });

    it('enter_renames', () => {
      const host: HTMLElement = flush();
      type(host, 'salute');
      flush();

      press(host, 'Enter');

      expect(renamed).toEqual(['salute']);
    });

    it('cancel_dismisses', () => {
      let dismissed: number = 0;
      fixture.componentInstance.dismissed.subscribe((): number => (dismissed += 1));

      button(flush(), 'Cancel').click();

      expect(dismissed).toBe(1);
      expect(renamed).toEqual([]);
    });
  });

  describe('RenameConfirmModal (#1015)', () => {
    it('listsEachFileWithItsChanges_andAnswersRenameOrCancel', async () => {
      const confirmation: RenameConfirmation = TestBed.inject(RenameConfirmation);
      const fixture: ComponentFixture<RenameConfirmModal> =
        TestBed.createComponent(RenameConfirmModal);
      fixture.detectChanges();
      const answer: Promise<boolean> = confirmation.ask({
        oldName: 'greet',
        newName: 'salute',
        files: [
          { path: '/ws/src/a.ts', name: 'a.ts', folder: 'src', edits: 3, open: true },
          { path: '/ws/lib/b.ts', name: 'b.ts', folder: 'lib', edits: 1, open: false },
        ],
      });
      fixture.detectChanges();
      const host: HTMLElement = flush();

      expect(host.textContent).toContain('Rename “greet” to “salute”?');
      expect(host.textContent).toContain('4 changes in 2 files.');
      expect(host.textContent).toContain('Open files change in their editors, unsaved');
      const rows: string[] = Array.from(host.querySelectorAll<HTMLElement>('.list-row')).map(
        (row: HTMLElement): string =>
          Array.from(row.querySelectorAll<HTMLElement>('span[class^="go-to-dialog__"]'))
            .map((span: HTMLElement): string => (span.textContent ?? '').trim())
            .join(' | '),
      );
      expect(rows).toEqual(['a.ts | src | 3 changes · open, unsaved', 'b.ts | lib | 1 change']);
      button(host, 'Rename').click();

      await expect(answer).resolves.toBe(true);
      expect(confirmation.pending()).toBeNull();
    });

    it('aCodeActionAcrossFiles_asksItsOwnQuestion_withItsOwnButton (#1016)', async () => {
      const confirmation: RenameConfirmation = TestBed.inject(RenameConfirmation);
      const fixture: ComponentFixture<RenameConfirmModal> =
        TestBed.createComponent(RenameConfirmModal);
      fixture.detectChanges();
      const answer: Promise<boolean> = confirmation.ask({
        oldName: 'Move to a new file',
        newName: '',
        title: 'Apply “Move to a new file”?',
        confirmLabel: 'Apply',
        files: [
          { path: '/ws/a.ts', name: 'a.ts', folder: '', edits: 2, open: false },
          { path: '/ws/b.ts', name: 'b.ts', folder: '', edits: 1, open: false },
        ],
      });
      fixture.detectChanges();
      const host: HTMLElement = flush();

      expect(host.textContent).toContain('Apply “Move to a new file”?');
      expect(host.textContent).not.toContain('Rename');
      button(host, 'Apply').click();

      await expect(answer).resolves.toBe(true);
    });

    it('cancel_answersNo', async () => {
      const confirmation: RenameConfirmation = TestBed.inject(RenameConfirmation);
      const fixture: ComponentFixture<RenameConfirmModal> =
        TestBed.createComponent(RenameConfirmModal);
      fixture.detectChanges();
      const answer: Promise<boolean> = confirmation.ask({
        oldName: 'a',
        newName: 'b',
        files: [{ path: '/ws/a.ts', name: 'a.ts', folder: '', edits: 2, open: false }],
      });
      fixture.detectChanges();

      button(flush(), 'Cancel').click();

      await expect(answer).resolves.toBe(false);
    });
  });

  describe('GoToDialogHost', () => {
    it('showsTheRenameDialog_andAnswersTheNameEntered (#1015)', async () => {
      TestBed.inject(Settings).set('textEditor.goToStyle', 'dialogs');
      const fixture: ComponentFixture<GoToDialogHost> = TestBed.createComponent(GoToDialogHost);
      fixture.detectChanges();
      const editor: MonacoApi.editor.ICodeEditor = {
        focus: (): void => undefined,
      } as unknown as MonacoApi.editor.ICodeEditor;

      const answer: Promise<string | null> = TestBed.inject(GoToPresenter).promptRename({
        editor,
        currentName: 'greet',
        injector: null,
      });
      fixture.detectChanges();
      let host: HTMLElement = flush();
      expect(host.textContent).toContain('Rename Symbol');
      type(host, 'salute');
      host = flush();
      button(host, 'Rename').click();

      await expect(answer).resolves.toBe('salute');
    });

    it('showsThePresentersDialog_andGoesWherePicked', () => {
      TestBed.overrideProvider(GoToSymbols, {
        useValue: { symbolsFor: (): Promise<readonly GoToSymbol[]> => Promise.resolve([]) },
      });
      TestBed.inject(Settings).set('textEditor.goToStyle', 'dialogs');
      const fixture: ComponentFixture<GoToDialogHost> = TestBed.createComponent(GoToDialogHost);
      fixture.detectChanges();
      const positions: MonacoApi.IPosition[] = [];
      const editor: MonacoApi.editor.ICodeEditor = {
        getModel: (): unknown => ({ getLineCount: (): number => 30 }),
        layout: (): void => undefined,
        setPosition: (position: MonacoApi.IPosition): number => positions.push(position),
        revealPositionInCenter: (): void => undefined,
        focus: (): void => undefined,
      } as unknown as MonacoApi.editor.ICodeEditor;

      TestBed.inject(GoToPresenter).present({ editor, mode: 'line', injector: null });
      fixture.detectChanges();
      let host: HTMLElement = flush();
      expect(host.textContent).toContain('Go to line 1–30');
      type(host, '5');
      host = flush();
      button(host, 'Go').click();
      fixture.detectChanges();

      expect(positions).toEqual([{ lineNumber: 5, column: 1 }]);
      expect(TestBed.inject(GoToPresenter).dialog()).toBeNull();
    });
  });
});
