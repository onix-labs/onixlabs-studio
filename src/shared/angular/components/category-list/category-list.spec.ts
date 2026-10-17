import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { CategoryItem, CategoryList } from './category-list';

/**
 * The entries every test lists: a parent with a nested child, and one without a count.
 */
const ITEMS: readonly CategoryItem[] = [
  { id: 'installed', label: 'Installed', icon: Icon.CHECK, count: 2 },
  { id: 'installed:llama', label: 'Llama', icon: Icon.AI_MODELS, nested: true },
  { id: 'available', label: 'Available', icon: Icon.DOWNLOAD },
];

describe('CategoryList', () => {
  let fixture: ComponentFixture<CategoryList>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CategoryList);
    fixture.componentRef.setInput('title', 'AI Manager');
    fixture.componentRef.setInput('items', ITEMS);
    fixture.componentRef.setInput('selectedId', 'available');
    fixture.detectChanges();
  });

  /**
   * Gets the rendered entries.
   * @returns Returns the entry buttons.
   */
  function entries(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.category-list__item'),
    );
  }

  /**
   * Gets the shared list's rows the entries sit in.
   * @returns Returns the rows.
   */
  function rows(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.list-row'),
    );
  }

  /**
   * Reads an entry's label, and its count when it shows one.
   * @param entry The entry.
   * @returns Returns the label and count, space-separated.
   */
  function read(entry: HTMLElement): string {
    return [
      entry.querySelector('.category-list__label')?.textContent?.trim(),
      entry.querySelector('.category-list__count')?.textContent?.trim(),
    ]
      .filter((part: string | undefined): boolean => part !== undefined)
      .join(' ');
  }

  it('render_showsTheTitleAndAnEntryPerItem_withCountsOnlyWhereGiven', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.category-list__title')?.textContent?.trim()).toBe('AI Manager');
    expect(entries().map(read)).toEqual(['Installed 2', 'Llama', 'Available']);
  });

  it('render_marksTheSelectedEntry_andIndentsNestedOnes', () => {
    const [installed, llama, available] = entries();

    // #954. The selection is the shared list's: a fill on the row, not bold text.
    expect(available.classList.contains('category-list__item--selected')).toBe(true);
    expect(rows()[2].classList.contains('active')).toBe(true);
    expect(rows()[2].getAttribute('aria-selected')).toBe('true');
    expect(installed.classList.contains('category-list__item--selected')).toBe(false);
    expect(llama.classList.contains('category-list__item--nested')).toBe(true);
  });

  it('click_emitsTheEntrysIdentifier', () => {
    const chosen: string[] = [];
    fixture.componentInstance.selectedIdChange.subscribe((id: string) => chosen.push(id));

    entries()[1].click();

    expect(chosen).toEqual(['installed:llama']);
  });

  it('disabledEntries_areListedButCannotBeChosen', () => {
    // #949. Local Models' Loaded is always listed, and greyed out while nothing is in memory.
    fixture.componentRef.setInput('items', [
      ...ITEMS,
      { id: 'loaded', label: 'Loaded', icon: Icon.AI_MODELS, count: 0, disabled: true },
    ]);
    fixture.detectChanges();
    const chosen: string[] = [];
    fixture.componentInstance.selectedIdChange.subscribe((id: string) => chosen.push(id));

    const loaded: HTMLElement = rows()[3];
    expect(loaded.getAttribute('aria-disabled')).toBe('true');
    loaded.click();
    expect(chosen).toEqual([]);
  });

  it('dividers_mutedEntriesAndBadges_render', () => {
    fixture.componentRef.setInput('items', [
      { id: 'a', label: 'A', icon: Icon.AI_MODELS, count: 1 },
      {
        id: 'b',
        label: 'B',
        icon: Icon.AI_MODELS,
        count: 3,
        dividerBefore: true,
        muted: true,
        badge: Icon.WARNING_FILL,
        badgeLabel: 'Not offered to agents',
      },
    ]);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.list-row--divided')).toHaveLength(1);
    const b: HTMLElement = entries()[1];
    expect(b.classList.contains('category-list__item--muted')).toBe(true);
    // A badge takes the count's place.
    expect(b.querySelector('.category-list__count')).toBeNull();
    expect(b.querySelector('.category-list__badge')?.getAttribute('title')).toBe(
      'Not offered to agents',
    );
  });

  it('search_isShownOnlyWhenAsked_andReportsWhatIsTyped', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.category-list__search')).toBeNull();

    fixture.componentRef.setInput('searchable', true);
    fixture.detectChanges();
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>(
      '.category-list__search input',
    )!;
    input.value = 'llama';
    input.dispatchEvent(new Event('input'));

    expect(fixture.componentInstance.query()).toBe('llama');
  });

  it('action_reportsItsEntry_withoutChoosingIt', () => {
    fixture.componentRef.setInput('items', [
      {
        id: 'a',
        label: 'A',
        icon: Icon.AI_MODELS,
        action: Icon.TRASH_DUOTONE,
        actionLabel: 'Delete A',
      },
    ]);
    fixture.detectChanges();
    const chosen: string[] = [];
    const acted: string[] = [];
    fixture.componentInstance.selectedIdChange.subscribe((id: string) => chosen.push(id));
    fixture.componentInstance.actionClick.subscribe((id: string) => acted.push(id));

    const action: HTMLButtonElement = (fixture.nativeElement as HTMLElement).querySelector(
      '.category-list__action',
    )!;
    expect(action.getAttribute('aria-label')).toBe('Delete A');
    action.click();

    expect(acted).toEqual(['a']);
    expect(chosen).toEqual([]);
  });
});
