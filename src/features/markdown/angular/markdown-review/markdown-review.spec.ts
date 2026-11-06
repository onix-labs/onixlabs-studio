import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import type { SpellingProbe } from '@shared/api/spelling-channels';
import { Spelling } from '@shared/angular/services/spelling/spelling';
import { Review } from './markdown-review';
import { applyReviewEdits } from './review-edits';
import { ReviewEdit, ReviewIssue, ReviewSession } from './review-types';

/**
 * A small in-memory review session whose source can be mutated, standing in for the live editor.
 */
class FakeSession implements ReviewSession {
  public source: string;
  public readonly history: string[] = [];
  public readonly reveal: (issue: ReviewIssue) => void = vi.fn();
  public readonly highlight: (issue: ReviewIssue) => void = vi.fn();
  public readonly clearHighlight: () => void = vi.fn();

  public constructor(source: string) {
    this.source = source;
  }

  public getSource(): string {
    return this.source;
  }

  public applyEdits(edits: readonly ReviewEdit[]): void {
    this.history.push(this.source);
    this.source = applyReviewEdits(this.source, edits);
  }

  public undo(): void {
    this.source = this.history.pop() ?? this.source;
  }
}

describe('Review', () => {
  let review: Review;

  beforeEach(() => {
    localStorage.clear();
    review = TestBed.inject(Review);
    review.setDictionaryLoader((): Promise<readonly string[]> =>
      Promise.resolve(['hello', 'world', 'the', 'cat', 'sat']),
    );
  });

  it('hasSession_whenNoSessionRegistered_isFalse', () => {
    expect(review.hasSession()).toBe(false);
  });

  it('hasSession_whenSessionRegistered_isTrue', () => {
    review.registerSession(new FakeSession(''));
    expect(review.hasSession()).toBe(true);
  });

  it('refresh_whenMisspelledWord_reportsSpellingIssue', async () => {
    review.registerSession(new FakeSession('helllo world'));
    await review.refresh();
    expect(review.ready()).toBe(true);
    expect(review.issues().some((issue: ReviewIssue): boolean => issue.word === 'helllo')).toBe(
      true,
    );
  });

  it('counts_whenIssuesFound_reflectsTheCategories', async () => {
    review.registerSession(new FakeSession('helllo the the'));
    await review.refresh();
    expect(review.counts().spelling).toBe(1);
    expect(review.counts().grammar).toBe(1);
  });

  it('setFilter_whenSetToGrammar_showsOnlyGrammarIssues', async () => {
    review.registerSession(new FakeSession('helllo the the'));
    await review.refresh();
    review.setFilter('grammar');
    expect(review.issues().every((issue: ReviewIssue): boolean => issue.kind === 'grammar')).toBe(
      true,
    );
  });

  it('applySuggestion_whenApplied_editsTheSessionAndClearsTheIssue', async () => {
    const session: FakeSession = new FakeSession('helllo world');
    review.registerSession(session);
    await review.refresh();
    const issue: ReviewIssue = review
      .issues()
      .find((candidate: ReviewIssue): boolean => candidate.word === 'helllo')!;

    review.applySuggestion(issue, 'hello');

    expect(session.source).toBe('hello world');
    expect(
      review.issues().some((candidate: ReviewIssue): boolean => candidate.word === 'helllo'),
    ).toBe(false);
  });

  it('ignore_whenIssueIgnored_removesItFromTheList', async () => {
    review.registerSession(new FakeSession('helllo world'));
    await review.refresh();
    const issue: ReviewIssue = review
      .issues()
      .find((candidate: ReviewIssue): boolean => candidate.word === 'helllo')!;

    review.ignoreAll(issue);

    expect(
      review.issues().some((candidate: ReviewIssue): boolean => candidate.word === 'helllo'),
    ).toBe(false);
  });

  it('addToDictionary_whenWordAdded_clearsItsSpellingIssue', async () => {
    review.registerSession(new FakeSession('helllo world'));
    await review.refresh();
    const issue: ReviewIssue = review
      .issues()
      .find((candidate: ReviewIssue): boolean => candidate.word === 'helllo')!;

    review.addToDictionary(issue);

    expect(
      review.issues().some((candidate: ReviewIssue): boolean => candidate.word === 'helllo'),
    ).toBe(false);
  });

  it('reveal_whenCalled_forwardsToTheSession', async () => {
    const session: FakeSession = new FakeSession('helllo world');
    review.registerSession(session);
    await review.refresh();
    const issue: ReviewIssue = review.issues()[0];

    review.reveal(issue);

    expect(session.reveal).toHaveBeenCalledWith(issue);
  });

  it('unregisterSession_whenRemoved_clearsTheFindings', async () => {
    const session: FakeSession = new FakeSession('helllo world');
    review.registerSession(session);
    await review.refresh();
    expect(review.issues().length).toBeGreaterThan(0);

    review.unregisterSession(session);

    expect(review.hasSession()).toBe(false);
    expect(review.issues().length).toBe(0);
  });

  it('addToDictionary_addsTheWordToTheSharedPersonalDictionary', async () => {
    review.registerSession(new FakeSession('helllo world'));
    await review.refresh();
    const issue: ReviewIssue | undefined = review
      .issues()
      .find((candidate: ReviewIssue): boolean => candidate.word === 'helllo');
    expect(issue).toBeDefined();

    review.addToDictionary(issue!);

    expect(TestBed.inject(Spelling).words()).toContain('helllo');
    expect(review.counts().spelling).toBe(0);
  });

  it('refresh_whenTheWordIsInThePersonalDictionaryFromSettings_doesNotFlagIt', async () => {
    TestBed.inject(Spelling).addWord('Helllo');
    review.registerSession(new FakeSession('helllo world'));

    await review.refresh();

    expect(review.counts().spelling).toBe(0);
  });
});

describe('Review walk', () => {
  let review: Review;

  /**
   * Starts a review of a source.
   * @param source The document source.
   * @returns Returns the session standing in for the editor.
   */
  async function start(source: string): Promise<FakeSession> {
    const session: FakeSession = new FakeSession(source);
    review.registerSession(session);
    await review.refresh();
    return session;
  }

  /**
   * Gets the word the walk is on.
   * @returns Returns the word, or undefined when no issue is left.
   */
  function currentWord(): string | undefined {
    return review.current()?.word;
  }

  /**
   * Gets the current issue, failing the test when there is none.
   * @returns Returns the issue.
   */
  function currentIssue(): ReviewIssue {
    const issue: ReviewIssue | null = review.current();
    if (issue === null) {
      throw new Error('Expected a current issue');
    }
    return issue;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    review = TestBed.inject(Review);
    review.setDictionaryLoader((): Promise<readonly string[]> =>
      Promise.resolve(['hello', 'world', 'the', 'cat', 'sat']),
    );
  });

  it('current_whenAnalysed_isTheFirstIssueAndIsRevealed', async () => {
    const session: FakeSession = await start('helllo wrld');

    expect(currentWord()).toBe('helllo');
    expect(review.position()).toBe(1);
    expect(session.reveal).toHaveBeenCalledWith(currentIssue());
  });

  it('current_whenNoIssues_isNullAndClearsTheHighlight', async () => {
    const session: FakeSession = await start('hello world');

    expect(review.current()).toBeNull();
    expect(review.position()).toBe(0);
    expect(session.clearHighlight).toHaveBeenCalled();
  });

  it('next_movesToTheFollowingIssueAndRevealsIt', async () => {
    const session: FakeSession = await start('helllo wrld');

    review.next();

    expect(currentWord()).toBe('wrld');
    expect(review.position()).toBe(2);
    expect(session.reveal).toHaveBeenLastCalledWith(currentIssue());
  });

  it('next_whenOnTheLastIssue_staysPut', async () => {
    await start('helllo wrld');
    review.next();

    review.next();

    expect(currentWord()).toBe('wrld');
  });

  it('previous_whenOnTheFirstIssue_staysPut', async () => {
    await start('helllo wrld');

    review.previous();

    expect(currentWord()).toBe('helllo');
  });

  it('previous_returnsToTheEarlierIssue', async () => {
    await start('helllo wrld');
    review.next();

    review.previous();

    expect(currentWord()).toBe('helllo');
  });

  it('setFilter_keepsTheWalkAmongTheFilteredIssues', async () => {
    await start('helllo the the');

    review.setFilter('grammar');

    expect(review.current()?.kind).toBe('grammar');
  });

  it('applySuggestion_movesOnToTheNextIssue', async () => {
    const session: FakeSession = await start('helllo wrld');

    review.applySuggestion(currentIssue(), 'hello');

    expect(session.source).toBe('hello wrld');
    expect(currentWord()).toBe('wrld');
    expect(session.reveal).toHaveBeenLastCalledWith(currentIssue());
  });

  it('applySuggestion_whenOnTheLastIssue_wrapsToOneSkippedEarlier', async () => {
    await start('helllo wrld');
    review.next();

    review.applySuggestion(currentIssue(), 'world');

    expect(currentWord()).toBe('helllo');
  });

  it('applySuggestion_whenTheLastIssueGoes_leavesNoIssue', async () => {
    const session: FakeSession = await start('helllo world');

    review.applySuggestion(currentIssue(), 'hello');

    expect(review.current()).toBeNull();
    expect(session.clearHighlight).toHaveBeenCalled();
  });

  it('applySuggestion_whenTheDocumentMovedOnBeforeReanalysis_changesNothing', async () => {
    const session: FakeSession = await start('helllo world');
    const stale: ReviewIssue = currentIssue();
    session.source = 'the helllo world';

    review.applySuggestion(stale, 'hello');

    expect(session.source).toBe('the helllo world');
    expect(session.history).toEqual([]);
    expect(review.current()?.start).toBe(4);
  });

  it('applySuggestionToAll_replacesEachExactMatchInOneStep', async () => {
    const session: FakeSession = await start('helllo wrld helllo Helllo');

    review.applySuggestionToAll(currentIssue(), 'hello');

    expect(session.source).toBe('hello wrld hello Helllo');
    expect(session.history).toHaveLength(1);
  });

  it('applySuggestionToAll_carriesOnFromTheCurrentIssue', async () => {
    await start('wrld helllo wrld plnt');
    review.next();

    review.applySuggestionToAll(currentIssue(), 'hello');

    expect(currentWord()).toBe('wrld');
    expect(review.current()?.start).toBe(11);
  });

  it('applySuggestionToAll_leavesAnOccurrenceIgnoredOnce', async () => {
    const session: FakeSession = await start('helllo the helllo');
    review.ignoreOnce(currentIssue());

    review.applySuggestionToAll(currentIssue(), 'hello');

    expect(session.source).toBe('helllo the hello');
  });

  it('applySuggestionToAll_whenAnyOffsetIsStale_changesNothing', async () => {
    const session: FakeSession = await start('helllo the helllo');
    const stale: ReviewIssue = currentIssue();
    session.source = 'helllo cat the helllo';

    review.applySuggestionToAll(stale, 'hello');

    expect(session.source).toBe('helllo cat the helllo');
  });

  it('ignoreOnce_skipsOnlyThatOccurrence', async () => {
    await start('helllo the helllo');

    review.ignoreOnce(currentIssue());

    expect(currentWord()).toBe('helllo');
    expect(review.current()?.start).toBe(11);
    expect(review.counts().spelling).toBe(1);
  });

  it('ignoreOnce_holdsWhenTextBeforeTheOccurrenceChanges', async () => {
    const session: FakeSession = await start('helllo the helllo');
    review.ignoreOnce(currentIssue());
    session.source = 'cat helllo the helllo';

    await review.refresh();

    expect(review.counts().spelling).toBe(1);
    expect(review.current()?.start).toBe(15);
  });

  it('ignoreOnce_whenTheDocumentCloses_isForgotten', async () => {
    const session: FakeSession = await start('helllo world');
    review.ignoreOnce(currentIssue());
    review.unregisterSession(session);

    await start('helllo world');

    expect(review.counts().spelling).toBe(1);
  });

  it('ignoreAll_skipsEveryOccurrence', async () => {
    await start('helllo wrld helllo');

    review.ignoreAll(currentIssue());

    expect(currentWord()).toBe('wrld');
    expect(review.counts().spelling).toBe(1);
  });

  it('addToDictionary_movesOnToTheNextIssue', async () => {
    await start('helllo wrld');

    review.addToDictionary(currentIssue());

    expect(currentWord()).toBe('wrld');
  });

  it('notifiedEdit_beforeTheCurrentIssue_keepsTheWalkOnIt', async () => {
    const session: FakeSession = await start('helllo wrld');
    review.next();
    session.source = 'the cat helllo wrld';

    await review.refresh();

    expect(currentWord()).toBe('wrld');
  });

  it('canUndo_isFalseUntilAnActionIsTaken', async () => {
    await start('helllo wrld');
    expect(review.canUndo()).toBe(false);

    review.ignoreOnce(currentIssue());

    expect(review.canUndo()).toBe(true);
  });

  it('undo_afterAChange_restoresTheTextAndReturnsToTheIssue', async () => {
    const session: FakeSession = await start('helllo wrld');
    review.applySuggestion(currentIssue(), 'hello');

    review.undo();

    expect(session.source).toBe('helllo wrld');
    expect(currentWord()).toBe('helllo');
    expect(review.canUndo()).toBe(false);
  });

  it('undo_afterChangeAll_restoresEveryOccurrenceInOneStep', async () => {
    const session: FakeSession = await start('helllo wrld helllo');
    review.applySuggestionToAll(currentIssue(), 'hello');

    review.undo();

    expect(session.source).toBe('helllo wrld helllo');
    expect(review.counts().spelling).toBe(3);
  });

  it('undo_afterIgnoreOnce_bringsTheOccurrenceBack', async () => {
    await start('helllo wrld');
    review.ignoreOnce(currentIssue());

    review.undo();

    expect(currentWord()).toBe('helllo');
    expect(review.counts().spelling).toBe(2);
  });

  it('undo_afterIgnoreOnce_findsTheOccurrenceAfterTextBeforeItChanged', async () => {
    const session: FakeSession = await start('helllo wrld');
    review.ignoreOnce(currentIssue());
    session.source = 'the helllo wrld';
    await review.refresh();

    review.undo();

    expect(currentWord()).toBe('helllo');
    expect(review.current()?.start).toBe(4);
  });

  it('undo_afterIgnoreAll_bringsEveryOccurrenceBack', async () => {
    await start('helllo the helllo');
    review.ignoreAll(currentIssue());

    review.undo();

    expect(review.counts().spelling).toBe(2);
  });

  it('undo_afterAddingAWord_removesItFromTheDictionary', async () => {
    await start('helllo world');
    review.addToDictionary(currentIssue());

    review.undo();

    expect(TestBed.inject(Spelling).words()).not.toContain('helllo');
    expect(currentWord()).toBe('helllo');
  });

  it('undo_whenTheUserEditedAfterAChange_doesNotUndoTheirEdit', async () => {
    const session: FakeSession = await start('helllo wrld');
    review.applySuggestion(currentIssue(), 'hello');
    session.source = 'hello wrld and more';

    review.undo();

    expect(session.source).toBe('hello wrld and more');
    expect(session.history).toHaveLength(1);
    expect(review.canUndo()).toBe(false);
  });

  it('undo_stepsBackThroughActionsMostRecentFirst', async () => {
    const session: FakeSession = await start('helllo wrld');
    review.applySuggestion(currentIssue(), 'hello');
    review.applySuggestion(currentIssue(), 'world');

    review.undo();
    expect(session.source).toBe('hello wrld');

    review.undo();
    expect(session.source).toBe('helllo wrld');
  });

  it('unregisterSession_clearsTheUndoList', async () => {
    const session: FakeSession = await start('helllo wrld');
    review.ignoreOnce(currentIssue());

    review.unregisterSession(session);

    expect(review.canUndo()).toBe(false);
  });
});

describe('Review with the app spell checker', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'spelling');
    localStorage.clear();
  });

  it('refresh_checksSpellingWithTheAppsCheckerRatherThanTheBundledList', async () => {
    // The bundled list would flag "colour" and accept "color"; the app's checker (here British) does
    // the opposite, and review must follow it.
    const probe: SpellingProbe = {
      isMisspelled: (word: string): boolean => word.toLowerCase() === 'color',
      suggestions: (): string[] => ['colour'],
    };
    Object.defineProperty(window, 'spelling', { value: probe, configurable: true });
    TestBed.resetTestingModule();
    const review: Review = TestBed.inject(Review);
    const loader: () => Promise<readonly string[]> = vi.fn((): Promise<readonly string[]> =>
      Promise.resolve(['color']),
    );
    review.setDictionaryLoader(loader);
    review.registerSession(new FakeSession('colour color'));

    await review.refresh();

    const spelling: readonly ReviewIssue[] = review
      .issues()
      .filter((issue: ReviewIssue): boolean => issue.kind === 'spelling');
    expect(spelling.map((issue: ReviewIssue): string => issue.word)).toEqual(['color']);
    expect(spelling[0].suggestions).toEqual(['colour']);
    expect(loader).not.toHaveBeenCalled();
  });
});
