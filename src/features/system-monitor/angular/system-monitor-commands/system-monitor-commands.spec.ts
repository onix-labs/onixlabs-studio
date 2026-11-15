import { signal, WritableSignal } from '@angular/core';
import { describe, expect, it, Mock, vi } from 'vitest';
import { SystemMonitorTabId } from '../tabs/system-monitor-tab-id';
import { SystemMonitorCommandHandler, SystemMonitorCommands } from './system-monitor-commands';

/**
 * A handler whose methods are spies and whose state is a controllable signal.
 */
interface FakeHandler {
  readonly handler: SystemMonitorCommandHandler;
  readonly refresh: Mock;
  readonly clearFilters: Mock;
  readonly agent: WritableSignal<boolean>;
  readonly toggleAgent: Mock;
  readonly tab: WritableSignal<SystemMonitorTabId>;
}

/**
 * Builds a handler whose methods are spies.
 * @returns Returns the fake handler.
 */
function fakeHandler(): FakeHandler {
  const refresh: Mock = vi.fn();
  const clearFilters: Mock = vi.fn();
  const agent: WritableSignal<boolean> = signal<boolean>(false);
  const toggleAgent: Mock = vi.fn();
  const tab: WritableSignal<SystemMonitorTabId> = signal<SystemMonitorTabId>(
    SystemMonitorTabId.Overview,
  );
  return {
    tab,
    refresh,
    clearFilters,
    agent,
    toggleAgent,
    handler: {
      agentShown: agent,
      toggleAgent,
      refresh,
      clearFilters,
      tab,
      selectTab: (next: SystemMonitorTabId): void => tab.set(next),
    },
  };
}

describe('SystemMonitorCommands', () => {
  it('withNoHandler_forwardsAreNoOps', () => {
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    expect((): void => {
      commands.refresh();
      commands.clearFilters();
    }).not.toThrow();
  });

  it('register_forwardsThroughTheCurrentHandler', () => {
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    const fake: FakeHandler = fakeHandler();
    commands.register(fake.handler);
    commands.refresh();
    commands.clearFilters();
    expect(fake.refresh).toHaveBeenCalledOnce();
    expect(fake.clearFilters).toHaveBeenCalledOnce();
  });

  it('agent_reflectsAndTogglesTheCurrentViewsAgent', () => {
    // #966.
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    expect(commands.agentShown()).toBe(false);
    const fake: FakeHandler = fakeHandler();
    commands.register(fake.handler);
    fake.agent.set(true);
    expect(commands.agentShown()).toBe(true);
    commands.toggleAgent();
    expect(fake.toggleAgent).toHaveBeenCalledOnce();
  });

  it('unregister_clearsOnlyTheCurrentHandler', () => {
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    const first: FakeHandler = fakeHandler();
    const second: FakeHandler = fakeHandler();
    commands.register(first.handler);
    commands.register(second.handler);
    commands.unregister(first.handler);
    commands.refresh();
    expect(second.refresh).toHaveBeenCalledOnce();
    commands.unregister(second.handler);
    commands.refresh();
    expect(second.refresh).toHaveBeenCalledOnce();
  });

  it('tab_followsTheActiveMonitor_andSelectTabSwitchesIt', () => {
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    expect(commands.tab()).toBeUndefined();

    const fake: FakeHandler = fakeHandler();
    commands.register(fake.handler);
    expect(commands.tab()).toBe(SystemMonitorTabId.Overview);

    commands.selectTab(SystemMonitorTabId.Storage);
    expect(commands.tab()).toBe(SystemMonitorTabId.Storage);
  });
});
