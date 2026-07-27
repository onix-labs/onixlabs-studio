import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { AgentSurface } from '@shared/api/ai-types';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { RunConfigurationAgent } from './run-configuration-agent';

/**
 * One recorded dispatch to a host's agent.
 */
interface SendCall {
  readonly text: string;
  readonly tabId?: string;
  readonly surface?: AgentSurface;
}

describe('RunConfigurationAgent', () => {
  let hosts: WritableSignal<readonly AgentHost[]>;
  let activeTabId: WritableSignal<string | undefined>;
  let root: WritableSignal<string | null>;
  let sends: SendCall[];
  let running: WritableSignal<boolean>;
  let requests: WritableSignal<readonly AgentRequestEntry[]>;

  /**
   * Builds a fake live host whose agent records what it is sent.
   * @param tabId The host's owning tab id.
   * @returns Returns the host.
   */
  function host(tabId: string): AgentHost {
    const agent: unknown = {
      isRunning: running,
      send: (text: string, owningTabId?: string, surface?: AgentSurface): void => {
        sends.push({ text, tabId: owningTabId, surface });
      },
    };
    return {
      id: `host-${tabId}`,
      tabId,
      label: signal<string>(tabId),
      surface: 'editor',
      agent,
      conversation: {},
      isActive: signal<boolean>(true),
    } as unknown as AgentHost;
  }

  beforeEach(() => {
    hosts = signal<readonly AgentHost[]>([]);
    activeTabId = signal<string | undefined>('tab-1');
    root = signal<string | null>('/work');
    running = signal<boolean>(false);
    requests = signal<readonly AgentRequestEntry[]>([]);
    sends = [];

    TestBed.configureTestingModule({
      providers: [
        { provide: AgentHosts, useValue: { hosts } as Partial<AgentHosts> },
        { provide: Tabs, useValue: { activeTabId } as Partial<Tabs> },
        { provide: ActiveWorkspace, useValue: { rootPath: root } as Partial<ActiveWorkspace> },
        { provide: AgentRequests, useValue: { entries: requests } as Partial<AgentRequests> },
      ],
    });
  });

  it('canDispatch_requiresAnOpenWorkspaceAndTheActiveTabsAgent', () => {
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);
    expect(seam.canDispatch()).toBe(false);
    expect(seam.unavailableReason()).toContain('agent');

    hosts.set([host('tab-1')]);
    expect(seam.canDispatch()).toBe(true);
    expect(seam.unavailableReason()).toBeNull();

    // No folder open: there is nowhere to write configurations, whatever the agent could do.
    root.set(null);
    expect(seam.canDispatch()).toBe(false);
    expect(seam.unavailableReason()).toContain('workspace folder');
  });

  it('dispatchAuto_sendsToTheActiveTabsAgentOnItsOwnSurface', () => {
    hosts.set([host('other'), host('tab-1')]);
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);

    expect(seam.dispatchAuto()).toBe(true);

    expect(sends).toHaveLength(1);
    expect(sends[0].tabId).toBe('tab-1');
    expect(sends[0].surface).toBe('editor');
    expect(sends[0].text).toContain("Set up this workspace's run configurations");
  });

  it('dispatchAuto_followsTheActiveTab', () => {
    hosts.set([host('tab-1'), host('tab-2')]);
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);

    activeTabId.set('tab-2');
    seam.dispatchAuto();

    expect(sends[0].tabId).toBe('tab-2');
  });

  it('dispatchRequest_carriesTheUsersWordsIntoThePrompt', () => {
    hosts.set([host('tab-1')]);
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);

    expect(seam.dispatchRequest('  run the three scripts in ./scripts in parallel  ')).toBe(true);

    expect(sends[0].text).toContain('run the three scripts in ./scripts in parallel');
    expect(sends[0].text).toContain('compound');
  });

  it('dispatchRequest_ignoresABlankRequest', () => {
    hosts.set([host('tab-1')]);
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);

    expect(seam.dispatchRequest('   ')).toBe(false);
    expect(sends).toEqual([]);
  });

  it('dispatch_withNothingToDispatchTo_reportsFailureRatherThanThrowing', () => {
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);

    expect(seam.dispatchAuto()).toBe(false);
    expect(sends).toEqual([]);
  });

  it('pendingRequests_surfacesOnlyTheDispatchedAgentsQuestions', () => {
    const mine: AgentHost = host('tab-1');
    const theirs: AgentHost = host('tab-2');
    hosts.set([mine, theirs]);
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);

    requests.set([
      {
        key: 'a',
        tabId: 'tab-2',
        label: 'Other',
        item: {},
        agent: theirs.agent,
      } as AgentRequestEntry,
      { key: 'b', tabId: 'tab-1', label: 'Mine', item: {}, agent: mine.agent } as AgentRequestEntry,
    ]);

    // The dialog is modal, so it must show its own agent's prompts — and only those.
    expect(seam.pendingRequests().map((entry: AgentRequestEntry): string => entry.key)).toEqual([
      'b',
    ]);
  });

  it('busy_followsTheResolvedAgentsRunState', () => {
    hosts.set([host('tab-1')]);
    const seam: RunConfigurationAgent = TestBed.inject(RunConfigurationAgent);

    expect(seam.busy()).toBe(false);
    running.set(true);
    expect(seam.busy()).toBe(true);
  });
});
