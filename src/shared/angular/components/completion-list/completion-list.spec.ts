import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import type { CompletionRow } from '@shared/angular/services/autocomplete/completion-rows';
import { Shell } from '@shared/angular/services/shell/shell';
import { CompletionList, CompletionListView, revealTop, VISIBLE_ROWS } from './completion-list';

/**
 * Builds a row.
 * @param index The row's index.
 * @returns Returns the row.
 */
function row(index: number): CompletionRow {
  return {
    icon: Icon.SYMBOL_FUNCTION,
    kindName: 'method',
    label: `item${index}`,
    runs: [
      { text: 'it', match: true },
      { text: `em${index}`, match: false },
    ],
    labelDetail: index === 0 ? '(a)' : null,
    detail: `detail ${index}`,
    deprecated: index === 1,
  };
}

/**
 * Builds a view.
 * @param count How many rows.
 * @param extra Members to override.
 * @returns Returns the view.
 */
function view(count: number, extra: Partial<CompletionListView> = {}): CompletionListView {
  return {
    count,
    row,
    focused: 0,
    message: null,
    details: null,
    placement: 'side',
    idPrefix: 'studio-completion-7',
    ...extra,
  };
}

describe('CompletionList (#1021)', () => {
  let fixture: ComponentFixture<CompletionList>;
  let opened: string[];

  beforeEach(async () => {
    opened = [];
    await TestBed.configureTestingModule({
      imports: [CompletionList],
      providers: [
        {
          provide: Shell,
          useValue: {
            openExternal: (url: string): Promise<void> => void opened.push(url) as never,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CompletionList);
  });

  /**
   * Shows a view and renders it.
   * @param value The view.
   */
  async function show(value: CompletionListView): Promise<void> {
    fixture.componentRef.setInput('view', value);
    await fixture.whenStable();
  }

  /**
   * Finds the rendered rows.
   * @returns Returns them.
   */
  function rows(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.completion-list__row'),
    );
  }

  it('rendersEachRow_withItsIcon_label_highlights_andDetail', async () => {
    await show(view(3));

    const first: HTMLElement = rows()[0];
    expect(first.querySelector('app-icon')).not.toBeNull();
    expect(first.querySelector('.completion-list__match')?.textContent).toBe('it');
    expect(first.querySelector('.completion-list__label')?.textContent?.replace(/\s+/g, '')).toBe(
      'item0(a)',
    );
    expect(first.querySelector('.completion-list__detail')?.textContent).toBe('detail 0');
    expect(rows()[1].querySelector('.completion-list__label--deprecated')).not.toBeNull();
  });

  it('isAListbox_whoseFocusedOptionIsItsActiveDescendant', async () => {
    await show(view(3, { focused: 2 }));

    const listbox: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="listbox"]',
    );
    expect(listbox?.getAttribute('aria-activedescendant')).toBe('studio-completion-7-2');
    expect(rows()[2].id).toBe('studio-completion-7-2');
    expect(rows()[2].getAttribute('aria-selected')).toBe('true');
    expect(rows()[2].classList).toContain('completion-list__row--focused');
    expect(rows()[0].getAttribute('aria-selected')).toBe('false');
    expect(rows()[2].getAttribute('aria-posinset')).toBe('3');
    expect(rows()[2].getAttribute('aria-setsize')).toBe('3');
  });

  it('rendersOnlyTheRowsThatCanBeSeen_ofAlongList', async () => {
    await show(view(5000));

    // A dozen visible and an overscan below: nowhere near five thousand.
    expect(rows().length).toBeLessThanOrEqual(VISIBLE_ROWS + 8);
    expect(rows()[0].getAttribute('aria-posinset')).toBe('1');
  });

  it('rendersTheRowsAroundTheFocus_whenItMovesFarDown', async () => {
    await show(view(5000, { focused: 4000 }));
    await fixture.whenStable();

    expect(
      rows().some((element: HTMLElement): boolean => element.id === 'studio-completion-7-4000'),
    ).toBe(true);
  });

  it('saysItsMessage_withNoRows', async () => {
    await show(view(0, { message: 'No suggestions.' }));

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent,
    ).toBe('No suggestions.');
  });

  it('aClickOnARow_saysWhichRowWasChosen', async () => {
    const chosen: number[] = [];
    fixture.componentInstance.chosen.subscribe((index: number): void => void chosen.push(index));
    await show(view(3));

    rows()[1]
      .querySelector('.completion-list__detail')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(chosen).toEqual([1]);
  });

  it('aPressOnTheList_neverTakesTheEditorsFocus', async () => {
    await show(view(3));
    const press: MouseEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    rows()[0].dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  it('showsTheDetailsPane_besideOrUnder', async () => {
    await show(view(1, { details: { sections: ['Some **docs**'] } }));
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.completion-list__details app-markdown-renderer')).not.toBeNull();
    expect(element.classList).not.toContain('completion-list--below');
    await show(view(1, { details: { sections: ['x'] }, placement: 'below' }));
    expect(element.classList).toContain('completion-list--below');
  });

  it('aWebLinkInTheDetails_opensInTheBrowser_andNavigatesNothing', async () => {
    await show(view(1, { details: { sections: ['x'] } }));
    const details: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.completion-list__details',
    );
    const link: HTMLAnchorElement = document.createElement('a');
    link.href = 'https://example.com/docs';
    details?.appendChild(link);
    const click: MouseEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(opened).toEqual(['https://example.com/docs']);
  });

  it('revealTop_movesTheListAsLittleAsItCan', () => {
    expect(revealTop(0, 20, 100, 240)).toBe(0);
    expect(revealTop(8, 20, 0, 240)).toBe(0);
    expect(revealTop(20, 20, 0, 240)).toBe(180);
    expect(revealTop(-1, 20, 55, 240)).toBe(55);
  });
});
