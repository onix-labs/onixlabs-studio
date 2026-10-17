import { TestBed } from '@angular/core/testing';
import { ForgeIssue, ForgeResult } from '@shared/api/forge-types';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { IssueActions } from './issue-actions';
import { IssueStore } from './issue-store';

/**
 * Builds an open issue.
 * @returns Returns the issue.
 */
function makeIssue(): ForgeIssue {
  return {
    number: 12,
    title: 'Something is broken',
    author: 'matthew',
    url: 'https://example.com/12',
    labels: [],
    assignees: [],
    state: 'open',
    body: '',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-02T10:00:00Z',
    commentCount: 0,
  };
}

describe('IssueActions', () => {
  let answer: ForgeResult<ForgeIssue>;
  let notified: NotificationRequest[];
  let actions: IssueActions;
  let store: IssueStore;

  beforeEach(() => {
    answer = { ok: false, error: 'Resource not accessible by integration.', unauthorized: false };
    notified = [];
    TestBed.configureTestingModule({
      providers: [
        IssueActions,
        IssueStore,
        {
          provide: ForgeRepository,
          useValue: {
            setIssueState: (): Promise<ForgeResult<ForgeIssue>> => Promise.resolve(answer),
            commentOnIssue: (): Promise<ForgeResult<never>> =>
              Promise.resolve({ ok: false, error: 'Locked.', unauthorized: false }),
          },
        },
        {
          provide: Notifications,
          useValue: {
            notify: (request: NotificationRequest): void => void notified.push(request),
          },
        },
      ],
    });
    actions = TestBed.inject(IssueActions);
    store = TestBed.inject(IssueStore);
    store.put('issue:12', makeIssue());
  });

  it('confirm_whenTheHostRefuses_saysWhy_andLeavesTheIssueAsItWas', async () => {
    actions.requestToggle(makeIssue());

    await actions.confirm('completed');

    expect(notified.map((request: NotificationRequest): string => request.title)).toEqual([
      'Could not close #12',
    ]);
    expect(notified[0].detail).toBe('Resource not accessible by integration.');
    expect(store.get('issue:12')?.issue.state).toBe('open');
    expect(actions.busy().size).toBe(0);
    expect(actions.pending()).toBeNull();
  });

  it('confirm_withNothingAsked_doesNothing', async () => {
    await actions.confirm('completed');

    expect(notified).toEqual([]);
  });

  it('dismiss_dropsTheQuestion', () => {
    actions.requestToggle(makeIssue());

    actions.dismiss();

    expect(actions.pending()).toBeNull();
  });

  it('comment_whenTheHostRefuses_saysWhy_andReportsFailure', async () => {
    expect(await actions.comment(makeIssue(), 'Hello')).toBe(false);
    expect(notified[0].title).toBe('Could not comment on #12');
  });

  it('isNotAutoProvided_soAViewWithoutItFailsLoudly', () => {
    // A root instance would reach a repository nothing has detected and refuse every request: the
    // bug that shipped a Close button that only ever said "no remote on a supported forge".
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});

    expect((): IssueActions => TestBed.inject(IssueActions)).toThrow();
  });
});
