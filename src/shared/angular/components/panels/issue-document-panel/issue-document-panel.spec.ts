import { signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ForgeCloseReason,
  ForgeIssue,
  ForgeIssueComment,
  ForgeRepositoryRef,
  ForgeResult,
} from '@shared/api/forge-types';
import type { HostingCapability } from '@shared/api/hosting-protocol';
import { Icon } from '@shared/angular/icons/icon';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import { IssueActions } from '@shared/angular/services/issues/issue-actions';
import { IssueAgent } from '@shared/angular/services/issues/issue-agent';
import { IssueStore } from '@shared/angular/services/issues/issue-store';
import { Shell } from '@shared/angular/services/shell/shell';

import { IssueDocumentPanel } from './issue-document-panel';

/**
 * Builds an issue, overriding whichever fields a test cares about.
 * @param overrides The fields to override.
 * @returns Returns the issue.
 */
function makeIssue(overrides: Partial<ForgeIssue> = {}): ForgeIssue {
  return {
    number: 12,
    title: 'Something is broken',
    author: 'matthew',
    url: 'https://example.com/12',
    labels: ['bug', 'area:git'],
    assignees: ['matthew'],
    state: 'open',
    body: 'Steps to **reproduce** are in the log.',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-02T10:00:00Z',
    commentCount: 0,
    ...overrides,
  };
}

/**
 * Builds the dock panel descriptor whose id names the hosted issue.
 * @param id The panel id.
 * @returns Returns the descriptor.
 */
function makePanel(id: string): DockPanel {
  return { id, title: '#12', icon: Icon.INFO, role: 'document', component: IssueDocumentPanel };
}

/**
 * A recording stand-in for this view's agent.
 */
class FakeAgent {
  public readonly messages: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the messages sent, in order.
   */
  public readonly sent: string[] = [];

  public readonly hasMessages: Signal<boolean> = this.messages.asReadonly();

  public send(text: string): void {
    this.sent.push(text);
  }
}

/**
 * A recording stand-in for the conversation, which owns starting a fresh one.
 */
class FakeConversation {
  public newChats: number = 0;

  public newChat(): void {
    this.newChats += 1;
  }
}

describe('IssueDocumentPanel', () => {
  let fixture: ComponentFixture<IssueDocumentPanel>;
  let issues: IssueStore;
  let host: HTMLElement;
  let opened: string[];
  let agent: FakeAgent;
  let conversation: FakeConversation;
  let revealed: string[];
  let allowed: Set<HostingCapability>;
  let stateRequests: { issue: number; state: string; reason?: ForgeCloseReason }[];
  let posted: string[];
  let thread: ForgeIssueComment[];

  beforeEach(async () => {
    opened = [];
    allowed = new Set<HostingCapability>();
    stateRequests = [];
    posted = [];
    thread = [];
    agent = new FakeAgent();
    conversation = new FakeConversation();
    revealed = [];
    await TestBed.configureTestingModule({
      imports: [IssueDocumentPanel],
      providers: [
        // The real seam over fakes, as the rail's tests drive it: the strip's job is only to ask it.
        IssueAgent,
        IssueActions,
        { provide: Agent, useValue: agent },
        { provide: AgentConversation, useValue: conversation },
        {
          provide: ForgeRepository,
          useValue: {
            repositoryRef: signal<ForgeRepositoryRef | null>({
              provider: 'GitHub',
              host: 'github.com',
              owner: 'onix-labs',
              name: 'onixlabs-studio',
            }),
            supports: (capability: HostingCapability): boolean => allowed.has(capability),
            closeReasons: signal<readonly ForgeCloseReason[]>(['completed', 'notPlanned']),
            issues: signal({ state: 'ready', items: [], message: null, stale: false }),
            setIssueState: (
              issue: number,
              state: 'open' | 'closed',
              reason?: ForgeCloseReason,
            ): Promise<ForgeResult<ForgeIssue>> => {
              stateRequests.push({ issue, state, ...(reason === undefined ? {} : { reason }) });
              return Promise.resolve({ ok: true, value: makeIssue({ state }) });
            },
            commentOnIssue: (
              _issue: number,
              body: string,
            ): Promise<ForgeResult<ForgeIssueComment>> => {
              const comment: ForgeIssueComment = {
                id: `${thread.length + 1}`,
                author: 'matthew',
                body,
                createdAt: '2026-10-13T10:00:00Z',
                url: 'https://example.com/c',
              };
              posted.push(body);
              thread.push(comment);
              return Promise.resolve({ ok: true, value: comment });
            },
            issueComments: (): Promise<ForgeResult<readonly ForgeIssueComment[]>> =>
              Promise.resolve({ ok: true, value: [...thread] }),
          },
        },
        {
          provide: DockReveal,
          useValue: {
            reveal: (panelId: string): void => {
              revealed.push(panelId);
            },
          },
        },
        {
          provide: Shell,
          useValue: {
            openExternal: (url: string): Promise<void> => {
              opened.push(url);
              return Promise.resolve();
            },
          },
        },
      ],
    }).compileComponents();

    issues = TestBed.inject(IssueStore);
    fixture = TestBed.createComponent(IssueDocumentPanel);
    host = fixture.nativeElement as HTMLElement;
  });

  it('render_whenNoIssueIsOpenForThePanelId_rendersNothing', () => {
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    expect(host.textContent?.trim()).toBe('');
  });

  it('render_showsTheTitleNumberBylineAndFacts', () => {
    issues.put('issue:12', makeIssue({ milestone: 'v0.13' }));
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('Something is broken');
    expect(text).toContain('#12');
    expect(text).toContain('matthew');
    expect(text).toContain('bug');
    expect(text).toContain('area:git');
    expect(text).toContain('v0.13');
    // The state is a chip on the status strip now, not on the tool strip (#882).
    expect(host.querySelector('app-panel-toolbar')?.textContent).not.toContain('open');
  });

  it('theIssuesStatus_isPublishedToTheStatusStrip_asAChipAndItsDetails', () => {
    issues.put('issue:12', makeIssue());
    const panel: DockPanel = makePanel('issue:12');
    const dockState: DockState = TestBed.inject(DockState);
    vi.spyOn(dockState, 'layout').mockReturnValue({
      kind: 'stack',
      id: 'well',
      role: 'document',
      panels: ['issue:12'],
      active: 'issue:12',
    } as unknown as ReturnType<DockState['layout']>);
    fixture.componentRef.setInput('panel', panel);
    fixture.detectChanges();

    const status: DocumentStatusInfo | null = TestBed.inject(DocumentStatus).info();
    expect(status?.chip).toEqual({ text: 'Open', tone: 'success', title: "The issue's state" });
    expect(status?.details?.map((detail: { text: string }): string => detail.text)[0]).toBe('#12');
  });

  it('render_rendersTheBodyAsMarkdown_ratherThanAsSource', () => {
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    // The asterisks are markup, not text: shown as source they would be the author's formatting
    // leaking onto the page.
    expect(host.querySelector('app-markdown-renderer')).not.toBeNull();
    expect(host.textContent).not.toContain('**reproduce**');
  });

  it('render_whenTheBodyIsEmpty_saysSoRatherThanShowingABlank', () => {
    issues.put('issue:12', makeIssue({ body: '   ' }));
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    expect(host.textContent).toContain('No description was given.');
  });

  it('render_showsEachLabelAsANeutralChip', () => {
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    const chips: HTMLElement[] = [...host.querySelectorAll<HTMLElement>('app-chip.issue__label')];
    expect(chips.map((chip: HTMLElement): string => chip.textContent?.trim() ?? '')).toEqual([
      'bug',
      'area:git',
    ]);
    expect(
      chips.every((chip: HTMLElement): boolean => chip.classList.contains('chip--neutral')),
    ).toBe(true);
  });

  it('render_omitsFactsTheIssueDoesNotHave', () => {
    // A heading with nothing after it is a question the reader has to answer for themselves.
    issues.put('issue:12', makeIssue({ labels: [], assignees: [] }));
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).not.toContain('Labels');
    expect(text).not.toContain('Assignees');
    expect(text).not.toContain('Milestone');
  });

  it('render_showsTheConversationOnceItHasBeenRead', () => {
    issues.put('issue:12', makeIssue({ commentCount: 1 }));
    issues.putComments('issue:12', [
      {
        id: '1',
        author: 'someone',
        body: 'Reproduced.',
        createdAt: '2026-08-02T09:00:00Z',
        url: 'https://example.com/c/1',
      },
    ]);
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('1 comment');
    expect(text).toContain('someone');
    expect(text).toContain('Reproduced.');
  });

  it('render_whenTheConversationFailed_saysWhyAndKeepsTheIssue', () => {
    issues.put('issue:12', makeIssue({ commentCount: 2 }));
    issues.putCommentsError('issue:12', 'Rate limited.');
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('Rate limited.');
    expect(text).toContain('Something is broken');
  });

  it('openInAgent_startsAConversationAboutTheIssueAndBringsTheAgentForward', () => {
    // The same two offers the issue's row makes, so what an issue can do does not depend on where it
    // is being read.
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[aria-label="Open in Agent"]')!.click();

    expect(conversation.newChats).toBe(1);
    expect(agent.sent[0]).toContain('#12');
    expect(agent.sent[0]).toContain('Something is broken');
    expect(revealed).toEqual(['agent']);
  });

  it('openInAgent_whenAConversationAlreadyHoldsSomething_asksBeforeReplacingIt', () => {
    agent.messages.set(true);
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[aria-label="Open in Agent"]')!.click();

    expect(conversation.newChats).toBe(0);
    expect(TestBed.inject(IssueAgent).pending()?.number).toBe(12);
  });

  it('openInBrowser_onTheMenu_opensTheIssueOnTheForge', () => {
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    // Open in Browser is on the strip's menu (#882).
    (fixture.componentInstance as unknown as { onMenu(id: string): void }).onMenu(
      'issue.openInBrowser',
    );

    expect(opened).toEqual(['https://example.com/12']);
  });
  it('stateControls_whenTheHostDoesNotAllowThem_areNotOffered', () => {
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    expect(host.querySelector('app-panel-toolbar')?.textContent).not.toContain('Close Issue');
    expect(host.querySelector('.issue__compose')).toBeNull();
  });

  it('closeIssue_asksWhy_thenClosesItWithTheReasonChosen', async () => {
    allowed.add('setIssueState');
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();
    const strip: HTMLElement = host.querySelector('app-panel-toolbar')!;
    expect(strip.textContent).toContain('Close Issue');

    [...strip.querySelectorAll<HTMLButtonElement>('button')]
      .find(
        (button: HTMLButtonElement): boolean =>
          button.textContent?.includes('Close Issue') ?? false,
      )!
      .click();
    const actions: IssueActions = TestBed.inject(IssueActions);
    expect(actions.pending()).toEqual({ issue: makeIssue(), state: 'closed' });
    expect(stateRequests).toEqual([]);

    await actions.confirm('notPlanned');
    fixture.detectChanges();

    expect(stateRequests).toEqual([{ issue: 12, state: 'closed', reason: 'notPlanned' }]);
    // The document shows the issue as the host now holds it, so the strip offers the way back.
    expect(host.querySelector('app-panel-toolbar')?.textContent).toContain('Reopen Issue');
  });

  it('reopenIssue_onAClosedIssue_reopensItWithoutAReason', async () => {
    allowed.add('setIssueState');
    issues.put('issue:12', makeIssue({ state: 'closed' }));
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { toggleState(): void }).toggleState();
    await TestBed.inject(IssueActions).confirm();

    expect(stateRequests).toEqual([{ issue: 12, state: 'open' }]);
  });

  it('comment_postsTheDraft_clearsIt_andShowsTheThreadAsTheHostHoldsIt', async () => {
    allowed.add('commentOnIssue');
    issues.put('issue:12', makeIssue());
    issues.putComments('issue:12', []);
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();
    expect(host.querySelector('.issue__compose')).not.toBeNull();
    const panel: { draft: WritableSignal<string>; postComment(): Promise<void> } =
      fixture.componentInstance as unknown as {
        draft: WritableSignal<string>;
        postComment(): Promise<void>;
      };

    panel.draft.set('  Fixed in **#931**.  ');
    await panel.postComment();
    fixture.detectChanges();

    expect(posted).toEqual(['Fixed in **#931**.']);
    expect(panel.draft()).toBe('');
    expect(issues.get('issue:12')?.issue.commentCount).toBe(1);
    expect(host.textContent).toContain('1 comment');
  });

  it('comment_whenTheDraftIsBlank_postsNothing', async () => {
    allowed.add('commentOnIssue');
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();
    const panel: { draft: WritableSignal<string>; postComment(): Promise<void> } =
      fixture.componentInstance as unknown as {
        draft: WritableSignal<string>;
        postComment(): Promise<void>;
      };

    panel.draft.set('   ');
    await panel.postComment();

    expect(posted).toEqual([]);
  });
});
