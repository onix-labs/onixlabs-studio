import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { AgentTabAttention } from '@shared/angular/services/agent-requests/agent-tab-attention';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

describe('AgentTabAttention', () => {
  let tabs: Tabs;
  let tabIds: WritableSignal<ReadonlySet<string>>;

  beforeEach(() => {
    tabIds = signal<ReadonlySet<string>>(new Set<string>());
    const requestsStub: Partial<AgentRequests> = { tabIds };

    TestBed.configureTestingModule({
      providers: [{ provide: AgentRequests, useValue: requestsStub }],
    });

    tabs = TestBed.inject(Tabs);
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * Reads whether a tab is showing its dot. The flag is optional on the model and a tab the bridge has
   * never marked simply does not carry it, so absent is read as off — the same way the template reads
   * it — rather than being distinguished from an explicit false.
   * @param id The tab identifier.
   * @returns Returns true when the tab wants attention.
   */
  function attentionOf(id: string): boolean {
    return tabs.tabs().find((candidate: Tab): boolean => candidate.id === id)?.attention ?? false;
  }

  it('lightsTheDot_forABackgroundTabWhoseAgentIsWaiting', () => {
    const background: Tab = tabs.open('code');
    tabs.open('terminal');
    TestBed.inject(AgentTabAttention);
    TestBed.tick();

    tabIds.set(new Set<string>([background.id]));
    TestBed.tick();

    expect(attentionOf(background.id)).toBe(true);
  });

  it('leavesTheActiveTabDark_becauseItsConversationIsAlreadyOnScreen', () => {
    const active: Tab = tabs.open('code');
    TestBed.inject(AgentTabAttention);
    TestBed.tick();

    tabIds.set(new Set<string>([active.id]));
    TestBed.tick();

    expect(attentionOf(active.id)).toBe(false);
  });

  it('lightsTheDot_whenTheUserSwitchesAwayFromTheWaitingTab', () => {
    const waiting: Tab = tabs.open('code');
    const other: Tab = tabs.open('terminal');
    tabs.activate(waiting.id);
    TestBed.inject(AgentTabAttention);
    tabIds.set(new Set<string>([waiting.id]));
    TestBed.tick();
    expect(attentionOf(waiting.id)).toBe(false);

    tabs.activate(other.id);
    TestBed.tick();

    expect(attentionOf(waiting.id)).toBe(true);
  });

  it('clearsTheDot_onceTheAskSettles', () => {
    const waiting: Tab = tabs.open('code');
    tabs.open('terminal');
    TestBed.inject(AgentTabAttention);
    tabIds.set(new Set<string>([waiting.id]));
    TestBed.tick();
    expect(attentionOf(waiting.id)).toBe(true);

    tabIds.set(new Set<string>());
    TestBed.tick();

    expect(attentionOf(waiting.id)).toBe(false);
  });

  it('marksEveryWaitingTab_whateverKindOfSurfaceItIs', () => {
    // The bridge reads the requests registry rather than any one chat, so a surface is covered as soon
    // as it registers its conversation against a tab — which is what makes this uniform across the
    // editors, the terminal, the workspace and the API explorer alike.
    const code: Tab = tabs.open('code');
    const terminal: Tab = tabs.open('terminal');
    const workspace: Tab = tabs.open('directory');
    const api: Tab = tabs.open('api-explorer');
    tabs.activate(code.id);
    TestBed.inject(AgentTabAttention);

    tabIds.set(new Set<string>([terminal.id, workspace.id, api.id]));
    TestBed.tick();

    expect(attentionOf(terminal.id)).toBe(true);
    expect(attentionOf(workspace.id)).toBe(true);
    expect(attentionOf(api.id)).toBe(true);
  });
});
