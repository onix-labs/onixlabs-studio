import { ApplicationRef, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForgeIssue, ForgeRepositoryRef } from '@shared/api/forge-types';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import { IssueAgent } from '@shared/angular/services/issues/issue-agent';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';

import { IssueAgentConfirm } from './issue-agent-confirm';

const ISSUE: ForgeIssue = {
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

/**
 * A recording stand-in for this view's agent.
 */
class FakeAgent {
  public readonly messages: WritableSignal<boolean> = signal<boolean>(true);

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

describe('IssueAgentConfirm', () => {
  let fixture: ComponentFixture<IssueAgentConfirm>;
  let issueAgent: IssueAgent;
  let agent: FakeAgent;
  let conversation: FakeConversation;
  let windows: FakeModalWindows;
  let revealed: string[];

  beforeEach(async () => {
    agent = new FakeAgent();
    conversation = new FakeConversation();
    windows = new FakeModalWindows();
    revealed = [];
    await TestBed.configureTestingModule({
      imports: [IssueAgentConfirm],
      providers: [
        IssueAgent,
        { provide: ModalWindows, useValue: windows },
        { provide: Agent, useValue: agent },
        { provide: AgentConversation, useValue: conversation },
        {
          provide: ForgeRepository,
          useValue: { repositoryRef: signal<ForgeRepositoryRef | null>(null) },
        },
        {
          provide: DockReveal,
          useValue: {
            reveal: (panelId: string): void => {
              revealed.push(panelId);
            },
          },
        },
      ],
    }).compileComponents();

    issueAgent = TestBed.inject(IssueAgent);
    fixture = TestBed.createComponent(IssueAgentConfirm);
    fixture.detectChanges();
  });

  /**
   * Gets the text of whatever the dialog is currently showing. Every modal is window-presented, so
   * the question renders in the window's content host rather than under this component.
   * @returns Returns the rendered text.
   */
  function shown(): string {
    TestBed.inject(ApplicationRef).tick();
    return windows.contentHost?.textContent ?? '';
  }

  it('render_whenNothingIsBeingAsked_opensNoWindow', () => {
    // Dropped into a host's template, it must cost that host nothing until there is a question.
    expect(windows.openWindows).toBe(0);
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('render_namesTheIssueTheNewConversationWouldBeAbout', () => {
    issueAgent.open(ISSUE);

    expect(shown()).toContain('Start a new conversation?');
    expect(windows.openWindows).toBe(1);
    expect(shown()).toContain('#12');
    expect(shown()).toContain('Something is broken');
  });

  it('yes_endsTheOldConversationAndStartsTheNewOne', () => {
    issueAgent.open(ISSUE);

    click('Yes');

    expect(conversation.newChats).toBe(1);
    expect(agent.sent.length).toBe(1);
    expect(issueAgent.pending()).toBeNull();
    expect(revealed).toEqual(['agent']);
  });

  it('no_leavesTheConversationAlone', () => {
    issueAgent.open(ISSUE);

    click('No');

    expect(conversation.newChats).toBe(0);
    expect(agent.sent).toEqual([]);
    expect(issueAgent.pending()).toBeNull();
    expect(revealed).toEqual([]);
  });

  /**
   * Clicks the answer with the given label.
   * @param label The button's label.
   */
  function click(label: string): void {
    TestBed.inject(ApplicationRef).tick();
    const buttons: readonly HTMLButtonElement[] = Array.from(
      windows.contentHost?.querySelectorAll('button') ?? [],
    );
    const button: HTMLButtonElement | undefined = buttons.find(
      (candidate: HTMLButtonElement): boolean => (candidate.textContent ?? '').trim() === label,
    );
    expect(button).toBeDefined();
    button!.click();
    TestBed.inject(ApplicationRef).tick();
  }
});
