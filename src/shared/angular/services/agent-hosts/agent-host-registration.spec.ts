import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { AgentSurface } from '@shared/api/ai-types';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AgentRequestSource, AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AgentHostRegistrar, createAgentHostRegistrar } from './agent-host-registration';

describe('createAgentHostRegistrar', () => {
  let hostPayload: Omit<AgentHost, 'id'> | undefined;
  let requestPayload: AgentRequestSource | undefined;
  let hostUnregistered: boolean;
  let requestUnregistered: boolean;
  let tabs: WritableSignal<readonly Tab[]>;
  let isActive: WritableSignal<boolean>;
  let agentStub: Agent;
  let conversationStub: AgentConversation;

  /**
   * Creates a registrar in an injection context wired to the test stubs, and finalises it for the
   * given tab.
   * @param tabId The owning tab's id.
   * @param surface The tool surface.
   * @returns Returns the registrar (already finalised for the tab).
   */
  function register(
    tabId: string,
    surface: AgentSurface = 'project',
    branch?: () => string | null,
  ): AgentHostRegistrar {
    const registrar: AgentHostRegistrar = TestBed.runInInjectionContext(() =>
      createAgentHostRegistrar({ isActive: isActive.asReadonly(), surface, branch }),
    );
    registrar.register(tabId);
    return registrar;
  }

  beforeEach(() => {
    hostPayload = undefined;
    requestPayload = undefined;
    hostUnregistered = false;
    requestUnregistered = false;
    tabs = signal<readonly Tab[]>([{ id: 'tab-1', title: 'My Tab' } as Tab]);
    isActive = signal<boolean>(false);
    agentStub = { name: 'agent' } as unknown as Agent;
    conversationStub = { name: 'conversation' } as unknown as AgentConversation;

    const hostsStub: Partial<AgentHosts> = {
      register: (payload: Omit<AgentHost, 'id'>): (() => void) => {
        hostPayload = payload;
        return (): void => void (hostUnregistered = true);
      },
    };
    const requestsStub: Partial<AgentRequests> = {
      register: (source: AgentRequestSource): (() => void) => {
        requestPayload = source;
        return (): void => void (requestUnregistered = true);
      },
    };
    const tabsStub: Partial<Tabs> = { tabs: tabs.asReadonly() };

    TestBed.configureTestingModule({
      providers: [
        { provide: Agent, useValue: agentStub },
        { provide: AgentConversation, useValue: conversationStub },
        { provide: AgentHosts, useValue: hostsStub },
        { provide: AgentRequests, useValue: requestsStub },
        { provide: Tabs, useValue: tabsStub },
      ],
    });
  });

  it('register_registersTheHostWithItsSurface_agent_conversation_andActiveState', () => {
    register('tab-1', 'terminal');

    expect(hostPayload).toBeDefined();
    expect(hostPayload?.tabId).toBe('tab-1');
    expect(hostPayload?.surface).toBe('terminal');
    expect(hostPayload?.agent).toBe(agentStub);
    expect(hostPayload?.conversation).toBe(conversationStub);
    // The active-state signal is forwarded from options, so the host tracks the source live.
    expect(hostPayload?.isActive()).toBe(false);
    isActive.set(true);
    expect(hostPayload?.isActive()).toBe(true);
  });

  it('register_registersTheRequestSource_withTheAgentAndTabAttribution', () => {
    register('tab-1');

    expect(requestPayload).toBeDefined();
    expect(requestPayload?.agent).toBe(agentStub);
    expect(requestPayload?.tabId()).toBe('tab-1');
    expect(requestPayload?.label()).toBe('My Tab');
  });

  it('label_reactivelyResolvesTheTabTitle_andFallsBackWhenTheTabIsGone', () => {
    register('tab-1');

    expect(hostPayload?.label()).toBe('My Tab');

    // A renamed tab updates the label...
    tabs.set([{ id: 'tab-1', title: 'Renamed' } as Tab]);
    expect(hostPayload?.label()).toBe('Renamed');

    // ...and a missing tab falls back to the generic name.
    tabs.set([]);
    expect(hostPayload?.label()).toBe('Agent');
  });

  it('branch_isOmitted_forAHostWithNoProjectBehindIt', () => {
    register('tab-1');

    expect(hostPayload?.branch).toBeUndefined();
  });

  it('branch_reactivelyResolvesTheProjectsBranch_throughTheSuppliedClosure', () => {
    const branch: WritableSignal<string | null> = signal<string | null>('main');
    register('tab-1', 'editor', (): string | null => branch());

    expect(hostPayload?.branch?.()).toBe('main');

    // A checkout in the owning view updates the host, so Mission Control follows it live...
    branch.set('feature/x');
    expect(hostPayload?.branch?.()).toBe('feature/x');

    // ...and a detached head (or a folder that is not a repository) reads null.
    branch.set(null);
    expect(hostPayload?.branch?.()).toBeNull();
  });

  it('destroy_unregistersFromBothRegistries', () => {
    register('tab-1');
    expect(hostUnregistered).toBe(false);
    expect(requestUnregistered).toBe(false);

    // Tearing down the injection context (the tab's lifetime) must remove both registrations.
    TestBed.resetTestingModule();

    expect(hostUnregistered).toBe(true);
    expect(requestUnregistered).toBe(true);
  });
});
