import { signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForgeIssue, ForgeRepositoryRef } from '@shared/api/forge-types';
import { Icon } from '@shared/angular/icons/icon';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
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

  beforeEach(async () => {
    opened = [];
    agent = new FakeAgent();
    conversation = new FakeConversation();
    revealed = [];
    await TestBed.configureTestingModule({
      imports: [IssueDocumentPanel],
      providers: [
        // The real seam over fakes, as the rail's tests drive it: the strip's job is only to ask it.
        IssueAgent,
        { provide: Agent, useValue: agent },
        { provide: AgentConversation, useValue: conversation },
        {
          provide: ForgeRepository,
          useValue: {
            repositoryRef: signal<ForgeRepositoryRef | null>({
              kind: 'github',
              host: 'github.com',
              owner: 'onix-labs',
              name: 'onixlabs-studio',
            }),
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
    expect(text).toContain('open');
  });

  it('render_rendersTheBodyAsMarkdown_ratherThanAsSource', () => {
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    // The asterisks are markup, not text: shown as source they would be the author's formatting
    // leaking onto the page.
    expect(host.querySelector('app-markdown-view')).not.toBeNull();
    expect(host.textContent).not.toContain('**reproduce**');
  });

  it('render_whenTheBodyIsEmpty_saysSoRatherThanShowingABlank', () => {
    issues.put('issue:12', makeIssue({ body: '   ' }));
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    expect(host.textContent).toContain('No description was given.');
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
        id: 1,
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

  it('openExternally_opensTheIssueOnTheForge', () => {
    issues.put('issue:12', makeIssue());
    fixture.componentRef.setInput('panel', makePanel('issue:12'));
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[aria-label="Open on GitHub"]')!.click();

    expect(opened).toEqual(['https://example.com/12']);
  });
});
