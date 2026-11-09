import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import type { GoToSymbol, GoToTarget } from '@shared/angular/services/go-to/go-to-model';
import { QuickOpen } from './quick-open';

/**
 * Builds a symbol on the given line.
 * @param name The name.
 * @param line The line, one-based.
 * @param container What it is declared in.
 * @returns Returns the symbol.
 */
function symbol(name: string, line: number, container: string = ''): GoToSymbol {
  return {
    id: `${name}@${line}`,
    name,
    container,
    icon: Icon.SYMBOL_FUNCTION,
    target: { line, column: 5, endLine: line, endColumn: 5 + name.length },
  };
}

describe('QuickOpen', () => {
  let fixture: ComponentFixture<QuickOpen>;
  let element: HTMLElement;
  let picked: GoToTarget[];
  let dismissed: number;
  let renamed: string[];
  let searched: string[];

  /**
   * Opens the box in a mode.
   * @param mode What it asks for.
   * @param symbols The document's symbols, or null while they are read.
   * @param currentName The name of the symbol being renamed, for rename mode.
   */
  function open(
    mode: 'symbol' | 'line' | 'rename' | 'workspace',
    symbols: readonly GoToSymbol[] | null = null,
    currentName: string = '',
  ): void {
    fixture = TestBed.createComponent(QuickOpen);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('lineCount', 250);
    fixture.componentRef.setInput('symbols', symbols);
    fixture.componentRef.setInput('currentName', currentName);
    picked = [];
    dismissed = 0;
    renamed = [];
    searched = [];
    fixture.componentInstance.searched.subscribe((query: string): number => searched.push(query));
    fixture.componentInstance.picked.subscribe((target: GoToTarget): number => picked.push(target));
    fixture.componentInstance.renamed.subscribe((name: string): number => renamed.push(name));
    fixture.componentInstance.dismissed.subscribe((): number => (dismissed += 1));
    fixture.detectChanges();
  }

  /**
   * Gets the box's field.
   * @returns Returns the input element.
   */
  function field(): HTMLInputElement {
    return element.querySelector<HTMLInputElement>('app-text-field input')!;
  }

  /**
   * Types into the field.
   * @param text What to type.
   */
  function type(text: string): void {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /**
   * Presses a key in the field.
   * @param key The key.
   * @returns Returns the event, to read whether it was cancelled.
   */
  function press(key: string): KeyboardEvent {
    const event: KeyboardEvent = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    field().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  /**
   * Gets the hint under the field.
   * @returns Returns its text.
   */
  function hint(): string {
    return element.querySelector('.quick-open__hint')?.textContent?.trim() ?? '';
  }

  /**
   * Gets the listed symbols' names, and which is selected.
   * @returns Returns the names, the selected one marked with a star.
   */
  function listed(): string[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.list-row')).map(
      (row: HTMLElement): string =>
        `${row.querySelector('.quick-open__name')?.textContent?.trim() ?? ''}${row.classList.contains('active') ? '*' : ''}`,
    );
  }

  describe('line mode', () => {
    beforeEach(() => open('line'));

    it('namesTheValidRange_beforeAnythingIsTyped', () => {
      expect(hint()).toBe('Go to line 1–250');
      expect(element.querySelector('app-list-view')).toBeNull();
    });

    it('takesALine_andGoesToItsStart_onEnter', () => {
      type('42');
      expect(hint()).toBe('Go to line 42');

      const enter: KeyboardEvent = press('Enter');

      expect(picked).toEqual([{ line: 42, column: 1 }]);
      // The editor takes focus while Enter is handled; left to run, it typed a newline there and
      // moved the caret a line down (Matthew's live test of #1009).
      expect(enter.defaultPrevented).toBe(true);
    });

    it('takesALineAndColumn', () => {
      type('42:10');
      expect(hint()).toBe('Go to line 42, column 10');

      press('Enter');

      expect(picked).toEqual([{ line: 42, column: 10 }]);
    });

    it('aLineOutOfRange_saysSo_andEnterGoesNowhere', () => {
      type('999');

      expect(hint()).toBe('Type a line between 1 and 250, or line:column');
      expect(element.querySelector('.quick-open__hint--invalid')).not.toBeNull();
      press('Enter');
      expect(picked).toEqual([]);
    });

    it('escape_dismisses', () => {
      press('Escape');

      expect(dismissed).toBe(1);
    });
  });

  describe('symbol mode', () => {
    const symbols: readonly GoToSymbol[] = [
      symbol('Greeter', 1),
      symbol('greet', 3, 'Greeter'),
      symbol('render', 9, 'View'),
    ];

    it('saysItIsReading_untilTheSymbolsArrive', () => {
      open('symbol', null);

      expect(hint()).toContain('Reading');
    });

    it('listsEverySymbol_withWhatItIsDeclaredIn_theFirstSelected', () => {
      open('symbol', symbols);

      expect(listed()).toEqual(['Greeter*', 'greet', 'render']);
      expect(element.querySelectorAll('.quick-open__container')[0]?.textContent).toBe('Greeter');
      expect(element.querySelectorAll('app-list-view app-icon').length).toBe(3);
    });

    it('filtersByName_asYouType', () => {
      open('symbol', symbols);

      type('rend');

      expect(listed()).toEqual(['render*']);
    });

    it('arrowsMoveTheSelection_andEnterGoesToIt', () => {
      open('symbol', symbols);

      press('ArrowDown');
      press('ArrowDown');
      press('ArrowDown');
      press('ArrowUp');
      expect(listed()).toEqual(['Greeter', 'greet*', 'render']);

      press('Enter');

      expect(picked).toEqual([symbols[1].target]);
    });

    it('clickingASymbol_goesToIt', () => {
      open('symbol', symbols);

      element.querySelectorAll<HTMLElement>('.list-row')[2].click();

      expect(picked).toEqual([symbols[2].target]);
    });

    it('nothingMatching_saysSo_andEnterGoesNowhere', () => {
      open('symbol', symbols);

      type('zzz');

      expect(element.textContent).toContain('No symbols match “zzz”');
      press('Enter');
      expect(picked).toEqual([]);
    });

    it('aFileWithNoSymbols_saysSo', () => {
      open('symbol', []);

      expect(element.textContent).toContain('No symbols in this file');
    });
  });

  describe('rename mode (#1015)', () => {
    beforeEach(() => open('rename', null, 'greet'));

    it('opensHoldingTheName_asksForANewOne_andListsNothing', () => {
      expect(field().value).toBe('greet');
      expect(field().placeholder).toBe('New name');
      expect(element.querySelector('[aria-label="Rename Symbol"]')).not.toBeNull();
      expect(element.querySelector('app-list-view')).toBeNull();
      expect(hint()).toBe('It is already named “greet”');
    });

    it('givesTheNewName_trimmed_onEnter', () => {
      type(' greeting ');
      expect(hint()).toBe('Enter to rename, Escape to cancel');

      const enter: KeyboardEvent = press('Enter');

      expect(renamed).toEqual(['greeting']);
      expect(picked).toEqual([]);
      expect(enter.defaultPrevented).toBe(true);
    });

    it('anEmptyNameOrTheSameName_saysSo_andEnterGivesNothing', () => {
      type('   ');
      expect(hint()).toBe('Type the new name');
      expect(element.querySelector('.quick-open__hint--invalid')).toBeNull();
      press('Enter');

      type('greet');
      expect(element.querySelector('.quick-open__hint--invalid')).not.toBeNull();
      press('Enter');

      expect(renamed).toEqual([]);
    });

    it('escape_dismisses', () => {
      press('Escape');

      expect(dismissed).toBe(1);
    });
  });

  describe('workspace mode (#1146)', () => {
    const found: GoToSymbol = {
      id: '0:/root/Services/FormalGreeter.cs:5:21',
      name: 'FormalGreeter',
      container: 'project Fixture.Services (net10.0)',
      icon: Icon.SYMBOL_CLASS,
      target: {
        path: '/root/Services/FormalGreeter.cs',
        line: 5,
        column: 21,
        endLine: 5,
        endColumn: 34,
      },
    };

    it('asksForANameAnywhereInTheWorkspace_andSaysToTypeOne', () => {
      open('workspace', []);

      expect(field().placeholder).toBe('Go to a symbol in the workspace');
      expect(element.querySelector('[aria-label="Go to Symbol in Workspace"]')).not.toBeNull();
      expect(element.textContent).toContain('Type a name to find it anywhere in the workspace');
    });

    it('reportsWhatIsTyped_forItsOpenerToSearch', () => {
      open('workspace', []);

      type('FoGr');
      type('FoGre');

      expect(searched).toEqual(['', 'FoGr', 'FoGre']);
    });

    it('listsWhatTheSearchFound_andGoesToTheChosenSymbolsFile', () => {
      open('workspace', []);
      type('FoGr');
      fixture.componentRef.setInput('symbols', [found]);
      fixture.detectChanges();

      expect(listed()).toEqual(['FormalGreeter*']);
      press('Enter');

      expect(picked).toEqual([found.target]);
    });

    it('aSearchThatFindsNothing_saysSo', () => {
      open('workspace', []);

      type('Nothing');

      expect(element.textContent).toContain('No symbols match “Nothing”');
    });

    it('otherModes_reportNothingTyped', () => {
      open('symbol', []);

      type('greet');

      expect(searched).toEqual([]);
    });
  });
});
