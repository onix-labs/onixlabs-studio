import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { Review } from './markdown-review';
import { ReviewIssue, ReviewSession } from './review-types';

/**
 * A small in-memory review session whose source can be mutated, standing in for the live editor.
 */
class FakeSession implements ReviewSession {
  public source: string;
  public readonly reveal: (issue: ReviewIssue) => void = vi.fn();

  public constructor(source: string) {
    this.source = source;
  }

  public getSource(): string {
    return this.source;
  }

  public applyEdit(start: number, end: number, replacement: string): void {
    this.source = this.source.slice(0, start) + replacement + this.source.slice(end);
  }
}

describe('Review', () => {
  let review: Review;

  beforeEach(() => {
    localStorage.clear();
    review = TestBed.inject(Review);
    review.setDictionaryLoader(
      (): Promise<readonly string[]> => Promise.resolve(['hello', 'world', 'the', 'cat', 'sat']),
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

    review.ignore(issue);

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
});
