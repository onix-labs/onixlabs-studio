import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { FindRequest, FindScope } from '@shared/angular/components/find-panel/find-request';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { SearchAdapter, SearchReplaceOutcome } from './search-adapter';
import { SearchView } from './search-view';

/**
 * A search adapter that records what the view asks of it and lists whatever it is told to.
 */
class FakeAdapter implements SearchAdapter {
  /**
   * Holds the chosen scope.
   */
  public readonly scope: WritableSignal<FindScope> = signal<FindScope>('file');

  /**
   * Holds whether the chosen scope searches the disk.
   */
  public readonly onDisk: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the matches.
   */
  public readonly matches: WritableSignal<readonly FindResultItem[]> = signal<
    readonly FindResultItem[]
  >([]);

  /**
   * Holds the active match's index.
   */
  public readonly activeIndex: WritableSignal<number> = signal<number>(-1);

  /**
   * Gets a value indicating that replace is supported.
   */
  public readonly supportsReplace: boolean = true;

  /**
   * Gets a value indicating that there is nothing to undo.
   */
  public readonly canUndo: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the queries set, in order.
   */
  public readonly queries: FindQuery[] = [];

  /**
   * Holds the indices selected, in order.
   */
  public readonly selected: number[] = [];

  /**
   * Holds whether the matches can be replaced.
   */
  public replaceable: boolean = true;

  /**
   * Records a query.
   * @param query The query.
   */
  public setQuery(query: FindQuery): void {
    this.queries.push(query);
  }

  /**
   * Records a selection, and makes it the active match.
   * @param index The index.
   */
  public select(index: number): void {
    this.selected.push(index);
    this.activeIndex.set(index);
  }

  /**
   * Chooses the scope.
   * @param scope The scope.
   */
  public setScope(scope: FindScope): void {
    this.scope.set(scope);
  }

  /**
   * Does nothing.
   */
  public next(): void {
    // Not driven by the view.
  }

  /**
   * Does nothing.
   */
  public previous(): void {
    // Not driven by the view.
  }

  /**
   * Does nothing.
   */
  public replace(): void {
    // Not driven by the view.
  }

  /**
   * Does nothing.
   */
  public replaceAll(): void {
    // Not driven by the view.
  }

  /**
   * Does nothing.
   */
  public undo(): void {
    // Not driven by the view.
  }

  /**
   * Clears the matches.
   */
  public clear(): void {
    this.matches.set([]);
  }

  /**
   * Gets the active match's file.
   * @returns Returns the path, or null.
   */
  public activePath(): string | null {
    return this.activeIndex() >= 0 ? '/a.ts' : null;
  }

  /**
   * Gets the files with matches.
   * @returns Returns the paths.
   */
  public paths(): readonly string[] {
    return ['/a.ts'];
  }

  /**
   * Gets whether the active match can be replaced.
   * @returns Returns the flag.
   */
  public activeReplaceable(): boolean {
    return this.replaceable;
  }

  /**
   * Gets whether any match can be replaced.
   * @returns Returns the flag.
   */
  public hasReplaceable(): boolean {
    return this.replaceable;
  }

  /**
   * Replaces nothing.
   * @returns Returns null.
   */
  public replaceMatch(): SearchReplaceOutcome {
    return null;
  }

  /**
   * Replaces nothing.
   * @returns Returns null.
   */
  public replaceFiles(): SearchReplaceOutcome {
    return null;
  }
}

describe('SearchView (#1007)', () => {
  let fixture: ComponentFixture<SearchView>;
  let adapter: FakeAdapter;
  let host: HTMLElement;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    await TestBed.configureTestingModule({
      imports: [SearchView],
      providers: [{ provide: Notifications, useValue: { notify: (): void => undefined } }],
    }).compileComponents();
    fixture = TestBed.createComponent(SearchView);
    fixture.componentRef.setInput('adapter', adapter);
    fixture.componentRef.setInput('scopes', ['file', 'selection']);
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Reads one of the view's protected members.
   * @param name The member.
   * @returns Returns its value.
   */
  function member<T>(name: string): T {
    return (fixture.componentInstance as unknown as Record<string, T>)[name];
  }

  /**
   * Gets the strip's toggles' labels.
   * @returns Returns the labels, in order.
   */
  function toggles(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.search-view__toggle')).map(
      (toggle: HTMLElement): string => toggle.textContent.trim(),
    );
  }

  /**
   * Gives the view a request, as its host does on each press.
   * @param request The request.
   */
  async function ask(request: FindRequest): Promise<void> {
    fixture.componentRef.setInput('request', request);
    await fixture.whenStable();
  }

  it('offersOnlyTheScopesItIsGiven_labelledAsTheWorkspacesAre', () => {
    expect(
      member<() => readonly DropdownOption[]>('scopeOptions')().map(
        (option: DropdownOption): string => option.label,
      ),
    ).toEqual(['Current File', 'Current Selection']);
  });

  it('hasAnExplicitFindButton_andSearchesOnlyWhenItIsPressed', async () => {
    member<WritableSignal<string>>('draft').set('todo');
    await fixture.whenStable();
    expect(adapter.queries).toEqual([]);

    Array.from(host.querySelectorAll<HTMLButtonElement>('.search-view__actions button'))
      .find((button: HTMLButtonElement): boolean => button.textContent.trim() === 'Find')
      ?.click();

    expect(adapter.queries.map((query: FindQuery): string => query.text)).toEqual(['todo']);
  });

  it('whereNothingCanBeReplaced_offersFindAlone_evenWhenAskedToReplace', async () => {
    fixture.componentRef.setInput('replaceable', false);
    await ask({ mode: 'replace', scope: 'file', seed: 'todo' });

    expect(toggles()).toEqual(['Find']);
    expect(member<() => string>('mode')()).toBe('find');
    expect(host.querySelectorAll('.search-view__form app-text-field').length).toBe(1);
  });

  it('aRequest_forASelectionItDoesNotHave_fallsBackToTheFile', async () => {
    fixture.componentRef.setInput('disabledScopes', new Set<FindScope>(['selection']));
    adapter.scope.set('selection');

    await ask({ mode: 'find', scope: 'selection', seed: 'todo' });

    expect(adapter.scope()).toBe('file');
    expect(adapter.queries.at(-1)?.text).toBe('todo');
  });

  it('clickingAMatch_selectsIt_whichIsWhatTakesItsEditorToIt', async () => {
    adapter.matches.set([
      { line: 2, column: 3, before: 'a ', text: 'todo', after: '', file: 'a.ts' },
      { line: 5, column: 1, before: '', text: 'todo', after: ' b', file: 'a.ts' },
    ]);
    await fixture.whenStable();
    const rows: HTMLElement[] = Array.from(
      host.querySelectorAll<HTMLElement>('.search-view__results .tree-row'),
    );

    rows[2].click();
    await fixture.whenStable();

    expect(adapter.selected).toEqual([1]);
    expect(host.querySelector('.search-view__results .tree-row.active')).toBe(
      host.querySelectorAll('.search-view__results .tree-row')[2],
    );
  });

  it('clearsTheAdapter_whenItGoes', () => {
    adapter.matches.set([{ line: 1, column: 1, before: '', text: 'x', after: '' }]);

    fixture.destroy();

    expect(adapter.matches()).toEqual([]);
  });
});
