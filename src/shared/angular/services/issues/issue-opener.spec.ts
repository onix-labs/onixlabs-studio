import { TestBed } from '@angular/core/testing';
import { ForgeIssue, ForgeIssueComment, ForgeResult } from '@shared/api/forge-types';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';

import { IssueOpener } from './issue-opener';
import { IssueStore, OpenIssue } from './issue-store';

/**
 * Builds an issue with the given number and comment count.
 * @param issueNumber The issue number.
 * @param commentCount How many comments it has.
 * @returns Returns the issue.
 */
function makeIssue(issueNumber: number, commentCount: number = 0): ForgeIssue {
  return {
    number: issueNumber,
    title: 'Something is broken',
    author: 'matthew',
    url: `https://example.com/${issueNumber}`,
    labels: ['bug'],
    assignees: [],
    state: 'open',
    body: 'Steps to reproduce.',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-02T10:00:00Z',
    commentCount,
  };
}

/**
 * Builds a comment.
 * @param id The comment identifier.
 * @returns Returns the comment.
 */
function makeComment(id: number): ForgeIssueComment {
  return {
    id,
    author: 'matthew',
    body: 'Reproduced.',
    createdAt: '2026-08-02T09:00:00Z',
    url: `https://example.com/c/${id}`,
  };
}

describe('IssueOpener', () => {
  let opener: IssueOpener;
  let issues: IssueStore;
  let dockState: DockState;
  let dockFocus: DockFocus;
  let registry: DockPanelRegistry;
  let asked: number[];
  let commentsResult: ForgeResult<readonly ForgeIssueComment[]>;

  /**
   * Gets the document well of the current layout.
   * @returns Returns the well, or null when the layout has none.
   */
  function well(): StackNode | null {
    return firstStackOfRole(dockState.layout(), 'document');
  }

  beforeEach(() => {
    localStorage.clear();
    asked = [];
    commentsResult = { ok: true, value: [makeComment(1)] };
    const forgeStub: Pick<ForgeRepository, 'issueComments'> = {
      issueComments: (issueNumber: number): Promise<ForgeResult<readonly ForgeIssueComment[]>> => {
        asked.push(issueNumber);
        return Promise.resolve(commentsResult);
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ForgeRepository, useValue: forgeStub }],
    });
    opener = TestBed.inject(IssueOpener);
    issues = TestBed.inject(IssueStore);
    dockState = TestBed.inject(DockState);
    dockFocus = TestBed.inject(DockFocus);
    registry = TestBed.inject(DockPanelRegistry);
  });

  it('open_registersAndTabsTheIssueIntoTheWell', () => {
    opener.open(makeIssue(12));

    const id: string = issues.idForIssue(12);
    expect(registry.get(id)?.title).toBe('#12');
    expect(registry.get(id)?.role).toBe('document');
    // Its own strip: the well's stubbed editor tools have nothing to do with an issue.
    expect(registry.get(id)?.ownsToolStrip).toBe(true);
    expect(well()?.panels).toContain(id);
    expect(well()?.active).toBe(id);
    expect(dockFocus.focusedStackId()).toBe(well()?.id);
  });

  it('open_showsTheIssueImmediately_withoutWaitingOnARequest', () => {
    // Everything but the conversation rides on the list entry, so the panel is complete on open.
    opener.open(makeIssue(12));

    const entry: OpenIssue | null = issues.get(issues.idForIssue(12));
    expect(entry?.issue.title).toBe('Something is broken');
    expect(entry?.issue.body).toBe('Steps to reproduce.');
  });

  it('open_whenTheIssueHasComments_readsThem', async () => {
    opener.open(makeIssue(12, 3));

    expect(asked).toEqual([12]);
    await Promise.resolve();
    await Promise.resolve();

    expect(issues.get(issues.idForIssue(12))?.comments).toHaveLength(1);
  });

  it('open_whenTheIssueHasNoComments_asksForNone', () => {
    // The count came with the list entry precisely so an empty conversation costs no request.
    opener.open(makeIssue(12, 0));

    expect(asked).toEqual([]);
    expect(issues.get(issues.idForIssue(12))?.comments).toEqual([]);
  });

  it('open_whenTheConversationCannotBeRead_keepsTheIssueAndReportsWhy', async () => {
    commentsResult = { ok: false, error: 'Rate limited.', unauthorized: false };

    opener.open(makeIssue(12, 2));
    await Promise.resolve();
    await Promise.resolve();

    const entry: OpenIssue | null = issues.get(issues.idForIssue(12));
    // The issue is still worth reading even when its replies are not available.
    expect(entry?.issue.number).toBe(12);
    expect(entry?.error).toBe('Rate limited.');
    expect(entry?.loading).toBe(false);
  });

  it('open_whenTheSameIssueIsOpenedAgain_reusesItsTab', () => {
    opener.open(makeIssue(12));
    opener.open(makeIssue(13));
    opener.open(makeIssue(12));

    const id: string = issues.idForIssue(12);
    expect(well()?.panels.filter((panel: string): boolean => panel === id)).toHaveLength(1);
    expect(well()?.active).toBe(id);
  });
});
