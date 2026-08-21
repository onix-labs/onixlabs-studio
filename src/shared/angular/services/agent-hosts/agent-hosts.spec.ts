import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { AgentSurface } from '@shared/api/ai-types';
import type { Agent } from '@shared/angular/services/agent/agent';
import type { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentHost, AgentHosts } from './agent-hosts';

/**
 * A fake agent whose run state the tests drive and whose stop command records itself.
 */
interface FakeAgent {
  /**
   * Gets the agent handed to the registry.
   */
  readonly agent: Agent;

  /**
   * Gets the writable run-state signal backing the agent.
   */
  readonly running: WritableSignal<boolean>;

  /**
   * Gets the number of times the agent was stopped.
   */
  readonly stops: () => number;

  /**
   * Gets the writable exposed-via-Remote-Control signal backing the agent.
   */
  readonly remote: WritableSignal<boolean>;
}

/**
 * Creates a fake agent whose `isRunning` and Remote Control signals are writable and whose `stop`
 * records its invocations.
 * @param running The initial run state.
 * @param supportsRemote Whether the agent's provider offers Remote Control at all.
 * @returns Returns the fake agent.
 */
function makeAgent(running: boolean = false, supportsRemote: boolean = true): FakeAgent {
  const runningState: WritableSignal<boolean> = signal<boolean>(running);
  const remoteState: WritableSignal<boolean> = signal<boolean>(false);
  let stopCount: number = 0;
  const agent: unknown = {
    isRunning: runningState.asReadonly(),
    stop: (): void => {
      stopCount += 1;
    },
    supportsRemoteControl: signal<boolean>(supportsRemote).asReadonly(),
    remoteControlEnabled: remoteState.asReadonly(),
    setRemoteControlEnabled: (enabled: boolean): void => remoteState.set(enabled),
  };
  return {
    agent: agent as Agent,
    running: runningState,
    stops: (): number => stopCount,
    remote: remoteState,
  };
}

/**
 * Builds a host registration (without its assigned id) around the given agent.
 * @param agent The host's agent session.
 * @param label The host's label.
 * @returns Returns the registration payload.
 */
function makeHost(agent: Agent, label: string = 'Agent'): Omit<AgentHost, 'id'> {
  return {
    tabId: null,
    label: signal<string>(label),
    surface: 'agent' as AgentSurface,
    agent,
    conversation: {} as AgentConversation,
    isActive: signal<boolean>(false),
  };
}

describe('AgentHosts', () => {
  let registry: AgentHosts;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(AgentHosts);
  });

  it('register_addsTheHostWithAnAssignedId', () => {
    registry.register(makeHost(makeAgent().agent, 'Alpha'));

    const hosts: readonly AgentHost[] = registry.hosts();
    expect(hosts.length).toBe(1);
    expect(hosts[0].id).toBe('agent-host-1');
    expect(hosts[0].label()).toBe('Alpha');
  });

  it('register_assignsAnIncrementingIdPerHost_inRegistrationOrder', () => {
    registry.register(makeHost(makeAgent().agent, 'Alpha'));
    registry.register(makeHost(makeAgent().agent, 'Beta'));

    expect(registry.hosts().map((host: AgentHost): string => host.id)).toEqual([
      'agent-host-1',
      'agent-host-2',
    ]);
    expect(registry.hosts().map((host: AgentHost): string => host.label())).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('register_whenTheSameAgentIsRegisteredTwice_dropsTheDuplicate', () => {
    const shared: FakeAgent = makeAgent();
    registry.register(makeHost(shared.agent, 'Up-front'));

    const secondUnregister: () => void = registry.register(makeHost(shared.agent, 'Docked'));

    // The up-front registration keeps ownership; the duplicate never joins the list.
    expect(registry.hosts().length).toBe(1);
    expect(registry.hosts()[0].label()).toBe('Up-front');
    // And the duplicate's unregister is a no-op that does not evict the winner.
    expect((): void => secondUnregister()).not.toThrow();
    expect(registry.hosts().length).toBe(1);
  });

  it('unregister_removesOnlyThatHost', () => {
    const first: () => void = registry.register(makeHost(makeAgent().agent, 'Alpha'));
    registry.register(makeHost(makeAgent().agent, 'Beta'));

    first();

    expect(registry.hosts().map((host: AgentHost): string => host.label())).toEqual(['Beta']);
  });

  it('register_afterUnregisteringAnAgent_reregistersItRatherThanDeduping', () => {
    const shared: FakeAgent = makeAgent();
    const unregister: () => void = registry.register(makeHost(shared.agent, 'First'));
    unregister();

    registry.register(makeHost(shared.agent, 'Second'));

    expect(registry.hosts().length).toBe(1);
    expect(registry.hosts()[0].label()).toBe('Second');
  });

  it('reorder_movesTheSourceHostToTheTargetsPosition', () => {
    registry.register(makeHost(makeAgent().agent, 'Alpha'));
    registry.register(makeHost(makeAgent().agent, 'Beta'));
    registry.register(makeHost(makeAgent().agent, 'Gamma'));

    // Move the last host to the front.
    registry.reorder('agent-host-3', 'agent-host-1');

    expect(registry.hosts().map((host: AgentHost): string => host.label())).toEqual([
      'Gamma',
      'Alpha',
      'Beta',
    ]);
  });

  it('reorder_movingForwards_settlesAtTheTargetsIndex', () => {
    registry.register(makeHost(makeAgent().agent, 'Alpha'));
    registry.register(makeHost(makeAgent().agent, 'Beta'));
    registry.register(makeHost(makeAgent().agent, 'Gamma'));

    // Move the first host to where the last one is.
    registry.reorder('agent-host-1', 'agent-host-3');

    expect(registry.hosts().map((host: AgentHost): string => host.label())).toEqual([
      'Beta',
      'Gamma',
      'Alpha',
    ]);
  });

  it('reorder_withTheSameSourceAndTarget_leavesTheOrderUnchanged', () => {
    registry.register(makeHost(makeAgent().agent, 'Alpha'));
    registry.register(makeHost(makeAgent().agent, 'Beta'));

    registry.reorder('agent-host-1', 'agent-host-1');

    expect(registry.hosts().map((host: AgentHost): string => host.label())).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('reorder_withAnUnknownId_leavesTheOrderUnchanged', () => {
    registry.register(makeHost(makeAgent().agent, 'Alpha'));
    registry.register(makeHost(makeAgent().agent, 'Beta'));

    registry.reorder('agent-host-1', 'agent-host-404');

    expect(registry.hosts().map((host: AgentHost): string => host.label())).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('runningCount_countsOnlyHostsWhoseAgentIsRunning', () => {
    const idle: FakeAgent = makeAgent(false);
    const busy: FakeAgent = makeAgent(true);
    registry.register(makeHost(idle.agent));
    registry.register(makeHost(busy.agent));

    expect(registry.runningCount()).toBe(1);

    idle.running.set(true);
    expect(registry.runningCount()).toBe(2);
  });

  it('stopAll_stopsRunningHostsOnly', () => {
    const idle: FakeAgent = makeAgent(false);
    const busy: FakeAgent = makeAgent(true);
    registry.register(makeHost(idle.agent));
    registry.register(makeHost(busy.agent));

    registry.stopAll();

    expect(busy.stops()).toBe(1);
    expect(idle.stops()).toBe(0);
  });

  it('remoteCapableHosts_leavesOutHostsWhoseProviderHasNoRemoteControl', () => {
    registry.register(makeHost(makeAgent(false, true).agent, 'Claude'));
    registry.register(makeHost(makeAgent(false, false).agent, 'Local model'));

    expect(registry.remoteCapableHosts().map((host: AgentHost): string => host.label())).toEqual([
      'Claude',
    ]);
  });

  it('allRemoteControlled_holdsOnlyWhenEveryCapableHostIsExposed', () => {
    const first: FakeAgent = makeAgent();
    const second: FakeAgent = makeAgent();
    registry.register(makeHost(first.agent));
    registry.register(makeHost(second.agent));

    expect(registry.allRemoteControlled()).toBe(false);

    first.remote.set(true);
    expect(registry.allRemoteControlled()).toBe(false);

    second.remote.set(true);
    expect(registry.allRemoteControlled()).toBe(true);
  });

  it('allRemoteControlled_withNothingToExpose_isFalse', () => {
    // Nothing exposed is not "everything exposed": a bulk toggle must not read as on with no agents
    // behind it, nor with only agents whose provider cannot be exposed at all.
    expect(registry.allRemoteControlled()).toBe(false);

    registry.register(makeHost(makeAgent(false, false).agent));
    expect(registry.allRemoteControlled()).toBe(false);
  });

  it('setRemoteControlAll_exposesEveryCapableHost_andLeavesTheRestAlone', () => {
    const capable: FakeAgent = makeAgent(false, true);
    const incapable: FakeAgent = makeAgent(false, false);
    registry.register(makeHost(capable.agent));
    registry.register(makeHost(incapable.agent));

    registry.setRemoteControlAll(true);

    expect(capable.remote()).toBe(true);
    expect(incapable.remote()).toBe(false);

    registry.setRemoteControlAll(false);

    expect(capable.remote()).toBe(false);
  });
});
