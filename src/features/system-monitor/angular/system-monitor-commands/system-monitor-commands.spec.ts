import { signal, WritableSignal } from '@angular/core';
import { describe, expect, it, Mock, vi } from 'vitest';
import { SystemMonitorCommandHandler, SystemMonitorCommands } from './system-monitor-commands';

/**
 * A handler whose methods are spies and whose state is a controllable signal.
 */
interface FakeHandler {
  readonly handler: SystemMonitorCommandHandler;
  readonly records: WritableSignal<boolean>;
  readonly refresh: Mock;
  readonly clearFilters: Mock;
  readonly copy: Mock;
  readonly agent: WritableSignal<boolean>;
  readonly toggleAgent: Mock;
}

/**
 * Builds a handler whose methods are spies.
 * @param hasRecords The initial has-records state.
 * @returns Returns the fake handler.
 */
function fakeHandler(hasRecords: boolean = true): FakeHandler {
  const records: WritableSignal<boolean> = signal<boolean>(hasRecords);
  const refresh: Mock = vi.fn();
  const clearFilters: Mock = vi.fn();
  const copy: Mock = vi.fn();
  const agent: WritableSignal<boolean> = signal<boolean>(false);
  const toggleAgent: Mock = vi.fn();
  return {
    records,
    refresh,
    clearFilters,
    copy,
    agent,
    toggleAgent,
    handler: { hasRecords: records, agentShown: agent, toggleAgent, refresh, clearFilters, copy },
  };
}

describe('SystemMonitorCommands', () => {
  it('withNoHandler_reportsNoRecordsAndForwardsAreNoOps', () => {
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    expect(commands.hasRecords()).toBe(false);
    expect((): void => {
      commands.refresh();
      commands.clearFilters();
      commands.copy();
    }).not.toThrow();
  });

  it('register_forwardsThroughTheCurrentHandler', () => {
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    const fake: FakeHandler = fakeHandler();
    commands.register(fake.handler);
    commands.refresh();
    commands.clearFilters();
    commands.copy();
    expect(fake.refresh).toHaveBeenCalledOnce();
    expect(fake.clearFilters).toHaveBeenCalledOnce();
    expect(fake.copy).toHaveBeenCalledOnce();
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

  it('hasRecords_reflectsTheCurrentHandler', () => {
    const commands: SystemMonitorCommands = new SystemMonitorCommands();
    const fake: FakeHandler = fakeHandler(false);
    commands.register(fake.handler);
    expect(commands.hasRecords()).toBe(false);
    fake.records.set(true);
    expect(commands.hasRecords()).toBe(true);
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
});
