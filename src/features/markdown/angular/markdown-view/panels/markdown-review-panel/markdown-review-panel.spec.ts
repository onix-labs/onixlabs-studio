import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Review } from '@features/markdown/angular/markdown-review/markdown-review';
import { applyReviewEdits } from '@features/markdown/angular/markdown-review/review-edits';
import { ReviewEdit, ReviewSession } from '@features/markdown/angular/markdown-review/review-types';
import { MarkdownReviewPanel } from './markdown-review-panel';

/**
 * A small in-memory review session standing in for the live editor.
 */
class FakeSession implements ReviewSession {
  public source: string;
  public undone: number = 0;

  public constructor(source: string) {
    this.source = source;
  }

  public getSource(): string {
    return this.source;
  }

  public applyEdits(edits: readonly ReviewEdit[]): void {
    this.source = applyReviewEdits(this.source, edits);
  }

  public undo(): void {
    this.undone += 1;
  }

  public reveal(): void {
    return;
  }

  public highlight(): void {
    return;
  }

  public clearHighlight(): void {
    return;
  }
}

describe('MarkdownReviewPanel', () => {
  let component: MarkdownReviewPanel;
  let fixture: ComponentFixture<MarkdownReviewPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownReviewPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownReviewPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_isTitledReview', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Review');
  });

  it('render_whenNoActiveEditor_promptsToOpenADocument', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.rv-empty')?.textContent).toContain('Open a markdown document');
    expect(element.querySelector('.rv-chips')).toBeNull();
  });

  /**
   * Starts a review of a source and renders it.
   * @param source The document source.
   * @returns Returns the session standing in for the editor.
   */
  async function review(source: string): Promise<FakeSession> {
    const service: Review = TestBed.inject(Review);
    service.setDictionaryLoader((): Promise<readonly string[]> =>
      Promise.resolve(['hello', 'help', 'world', 'the']),
    );
    const session: FakeSession = new FakeSession(source);
    service.registerSession(session);
    await service.refresh();
    await fixture.whenStable();
    return session;
  }

  /**
   * Gets the panel's rendered element.
   * @returns Returns the element.
   */
  function panel(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Finds a button by its visible label or accessible name.
   * @param label The label.
   * @returns Returns the button, if it is showing.
   */
  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(panel().querySelectorAll('button')).find(
      (candidate: HTMLButtonElement): boolean =>
        candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
    );
  }

  /**
   * Clicks a button and waits for the panel to settle.
   * @param label The button's label.
   */
  async function click(label: string): Promise<void> {
    button(label)?.click();
    await fixture.whenStable();
  }

  it('render_showsOneIssueAtATimeWithItsPosition', async () => {
    await review('helllo wrld');

    expect(panel().querySelector('[data-testid="review-position"]')?.textContent).toContain(
      '1 of 2',
    );
    expect(panel().querySelector('[data-testid="review-context"]')?.textContent).toContain(
      'helllo',
    );
  });

  it('render_listsTheSuggestionsWithTheFirstSelected', async () => {
    await review('helllo world');

    const options: readonly HTMLElement[] = Array.from(
      panel().querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
  });

  it('render_whenTheIssueHasNoSuggestions_hidesChangeAndMakesIgnoreOnceTheSolidButton', async () => {
    await review('The file was written by the team.');

    expect(button('Change')).toBeUndefined();
    expect(button('Change All')).toBeUndefined();
    expect(panel().querySelector('[role="option"]')).toBeNull();
    expect(button('Ignore Once')?.closest('app-button')?.className).toContain('button--solid');
  });

  it('render_whenTheIssueHasSuggestions_makesChangeTheOnlySolidButton', async () => {
    await review('helllo world');

    expect(panel().querySelectorAll('app-button.button--solid')).toHaveLength(1);
    expect(button('Change')?.closest('app-button')?.className).toContain('button--solid');
  });

  it('render_whenTheIssueIsNotSpelling_hidesAdd', async () => {
    await review('the the world');

    expect(button('Add')).toBeUndefined();
  });

  it('change_appliesTheChosenSuggestionAndMovesOn', async () => {
    const session: FakeSession = await review('helllo wrld');
    const options: readonly HTMLElement[] = Array.from(
      panel().querySelectorAll<HTMLElement>('[role="option"]'),
    );
    const last: HTMLElement = options[options.length - 1];
    last.click();
    await fixture.whenStable();

    await click('Change');

    expect(session.source).toBe(`${last.textContent?.trim()} wrld`);
    expect(panel().querySelector('[data-testid="review-context"]')?.textContent).toContain('wrld');
  });

  it('changeAll_replacesEveryOccurrence', async () => {
    const session: FakeSession = await review('helllo the helllo');

    await click('Change All');

    expect(session.source).not.toContain('helllo');
  });

  it('nextAndPrevious_moveThroughTheIssues', async () => {
    await review('helllo wrld');

    await click('Next issue');
    expect(panel().querySelector('[data-testid="review-position"]')?.textContent).toContain(
      '2 of 2',
    );
    expect(button('Next issue')?.disabled).toBe(true);

    await click('Previous issue');
    expect(button('Previous issue')?.disabled).toBe(true);
  });

  it('ignoreAll_whenTheLastIssueGoes_saysNoneAreLeftAndKeepsUndo', async () => {
    await review('helllo world');

    await click('Ignore All');

    expect(panel().querySelector('.rv-empty')?.textContent).toContain('No issues found');
    expect(button('Undo')?.disabled).toBe(false);
  });

  it('undo_bringsTheIssueBack', async () => {
    await review('helllo world');
    await click('Ignore Once');

    await click('Undo');

    expect(panel().querySelector('[data-testid="review-context"]')?.textContent).toContain(
      'helllo',
    );
    expect(button('Undo')?.disabled).toBe(true);
  });
});
