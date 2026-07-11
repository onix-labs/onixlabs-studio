import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FindAdapter, FindQuery, FindResultItem } from './find-adapter';
import { FindPanel } from './find-panel';

describe('FindPanel', () => {
  let component: FindPanel;
  let fixture: ComponentFixture<FindPanel>;
  let host: HTMLElement;
  let matches: WritableSignal<readonly FindResultItem[]>;
  let activeIndex: WritableSignal<number>;
  let canUndo: WritableSignal<boolean>;
  let queries: FindQuery[];
  let selections: number[];
  let replacements: string[];
  let allReplacements: string[];
  let clearCalls: number;

  /**
   * Creates a controllable adapter stub that records every call the panel makes.
   * @param supportsReplace A value indicating whether the stubbed surface supports replace.
   * @returns Returns the stub adapter.
   */
  function createAdapter(supportsReplace: boolean): FindAdapter {
    return {
      matches,
      activeIndex,
      supportsReplace,
      canUndo,
      setQuery: (query: FindQuery): void => void queries.push(query),
      select: (index: number): void => void selections.push(index),
      next: (): void => undefined,
      previous: (): void => undefined,
      replace: (replacement: string): void => void replacements.push(replacement),
      replaceAll: (replacement: string): void => void allReplacements.push(replacement),
      undo: (): void => undefined,
      clear: (): void => void (clearCalls += 1),
    };
  }

  /**
   * Creates a find match at the given line.
   * @param line The one-based line number of the match.
   * @returns Returns the match.
   */
  function match(line: number): FindResultItem {
    return { line, column: 1, before: 'the ', text: 'word', after: ' after' };
  }

  /**
   * Sets the panel's find text, as typing into the find field would.
   * @param text The find text.
   */
  function typeQuery(text: string): void {
    (component as unknown as { findText: WritableSignal<string> }).findText.set(text);
  }

  beforeAll(() => {
    // jsdom does not implement scrollIntoView; the panel calls it to keep the active row visible.
    const prototype: { scrollIntoView?: () => void } = Element.prototype;
    prototype.scrollIntoView ??= (): void => undefined;
  });

  beforeEach(async () => {
    matches = signal<readonly FindResultItem[]>([]);
    activeIndex = signal<number>(-1);
    canUndo = signal<boolean>(false);
    queries = [];
    selections = [];
    replacements = [];
    allReplacements = [];
    clearCalls = 0;

    await TestBed.configureTestingModule({
      imports: [FindPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(FindPanel);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('adapter', createAdapter(true));
    await fixture.whenStable();
  });

  it('setQuery_whenTheFindTextChanges_pushesTheQueryToTheAdapter', async () => {
    typeQuery('needle');
    await fixture.whenStable();

    expect(queries[queries.length - 1]).toEqual({
      text: 'needle',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    });
  });

  it('matchLabel_summarisesTheMatchesBesideTheFindField', async () => {
    typeQuery('word');
    matches.set([match(1), match(2), match(3)]);
    activeIndex.set(1);
    await fixture.whenStable();
    expect(host.querySelector('.find-panel__count')?.textContent).toContain('2 of 3');

    activeIndex.set(-1);
    await fixture.whenStable();
    expect(host.querySelector('.find-panel__count')?.textContent).toContain('3 found');

    matches.set([]);
    await fixture.whenStable();
    expect(host.querySelector('.find-panel__count')?.textContent).toContain('No results');
  });

  it('navigation_disablesPreviousAtTheFirstMatchAndNextAtTheLast', async () => {
    matches.set([match(1), match(2)]);
    activeIndex.set(0);
    await fixture.whenStable();

    const buttons: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.find-panel__nav .find-panel__button'),
    );
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);

    activeIndex.set(1);
    await fixture.whenStable();
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });

  it('resultClick_selectsTheClickedMatch', async () => {
    matches.set([match(1), match(2)]);
    await fixture.whenStable();

    const rows: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.find-panel__result'),
    );
    rows[1].click();

    expect(selections).toEqual([1]);
  });

  it('title_andReplaceAffordances_followTheAdapterSupportsReplaceFlag', async () => {
    expect(host.querySelector('.find-panel__title')?.textContent).toContain('Find and Replace');
    expect(host.querySelector('.find-panel__segmented')).not.toBeNull();

    fixture.componentRef.setInput('adapter', createAdapter(false));
    await fixture.whenStable();

    expect(host.querySelector('.find-panel__title')?.textContent?.trim()).toBe('Find');
    expect(host.querySelector('.find-panel__segmented')).toBeNull();
  });

  it('replaceMode_showsTheReplaceControlsAndReplacesAllThroughTheAdapter', async () => {
    matches.set([match(1)]);
    activeIndex.set(0);
    await fixture.whenStable();

    const segments: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.find-panel__segment'),
    );
    segments[1].click();
    await fixture.whenStable();

    (component as unknown as { replaceText: WritableSignal<string> }).replaceText.set('swap');
    await fixture.whenStable();

    const actions: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.find-panel__replace-actions .find-panel__button'),
    );
    expect(actions.length).toBe(3);
    actions[1].click();

    expect(allReplacements).toEqual(['swap']);
    expect(replacements).toEqual([]);
  });

  it('dismiss_clearsTheAdapterHighlightsAndEmitsClosed', async () => {
    let closed: number = 0;
    component.closed.subscribe((): void => void (closed += 1));
    await fixture.whenStable();

    host.querySelector<HTMLButtonElement>('.find-panel__icon-button')?.click();

    expect(clearCalls).toBe(1);
    expect(closed).toBe(1);
  });

  it('destroy_clearsTheAdapterHighlights', async () => {
    await fixture.whenStable();

    fixture.destroy();

    expect(clearCalls).toBe(1);
  });
});
