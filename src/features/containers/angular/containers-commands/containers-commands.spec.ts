import { describe, expect, it, Mock, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { ContainersCommandHandler, ContainersCommands } from './containers-commands';

/**
 * A handler paired with its action spies, so a test can both register it and assert its calls.
 */
interface FakeHandler {
  readonly handler: ContainersCommandHandler;
  readonly start: Mock;
  readonly stop: Mock;
  readonly remove: Mock;
  readonly viewLogs: Mock;
  readonly shell: Mock;
  readonly refresh: Mock;
}

/**
 * Builds a handler whose action methods are spies and whose running state is fixed.
 * @param running Whether the selected container reads as running.
 * @returns Returns the handler and its spies.
 */
function fakeHandler(running: boolean): FakeHandler {
  const start: Mock = vi.fn();
  const stop: Mock = vi.fn();
  const remove: Mock = vi.fn();
  const viewLogs: Mock = vi.fn();
  const shell: Mock = vi.fn();
  const refresh: Mock = vi.fn();
  const handler: ContainersCommandHandler = {
    hasSelection: computed((): boolean => true),
    selectionRunning: signal(running),
    start,
    stop,
    remove,
    viewLogs,
    shell,
    refresh,
  };
  return { handler, start, stop, remove, viewLogs, shell, refresh };
}

describe('ContainersCommands', () => {
  it('forwardsToTheRegisteredHandlerAndReflectsItsState', () => {
    const commands: ContainersCommands = new ContainersCommands();
    const fake: FakeHandler = fakeHandler(true);
    commands.register(fake.handler);

    expect(commands.hasSelection()).toBe(true);
    expect(commands.selectionRunning()).toBe(true);

    commands.start();
    commands.stop();
    commands.remove();
    commands.viewLogs();
    commands.shell();
    commands.refresh();

    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(fake.viewLogs).toHaveBeenCalledTimes(1);
    expect(fake.shell).toHaveBeenCalledTimes(1);
    expect(fake.refresh).toHaveBeenCalledTimes(1);
  });

  it('isInertWithNoHandler', () => {
    const commands: ContainersCommands = new ContainersCommands();
    expect(commands.hasSelection()).toBe(false);
    expect(commands.selectionRunning()).toBe(false);
    expect((): void => commands.start()).not.toThrow();
  });

  it('unregisterOnlyClearsTheCurrentHandler', () => {
    const commands: ContainersCommands = new ContainersCommands();
    const first: FakeHandler = fakeHandler(false);
    const second: FakeHandler = fakeHandler(true);
    commands.register(first.handler);
    commands.register(second.handler);

    commands.unregister(first.handler); // not current — no effect
    expect(commands.selectionRunning()).toBe(true);

    commands.unregister(second.handler); // current — clears
    expect(commands.hasSelection()).toBe(false);
  });
});
