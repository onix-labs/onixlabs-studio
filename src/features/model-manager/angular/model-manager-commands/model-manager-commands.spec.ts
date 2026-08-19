import { describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { ModelManagerCommandHandler, ModelManagerCommands } from './model-manager-commands';

/**
 * Builds a handler recording the calls made through it.
 */
function handlerWith(
  running: boolean = false,
  stoppable: boolean = false,
): { handler: ModelManagerCommandHandler; calls: string[]; busy: WritableSignal<boolean> } {
  const calls: string[] = [];
  const busy: WritableSignal<boolean> = signal<boolean>(false);
  const handler: ModelManagerCommandHandler = {
    running: signal<boolean>(running),
    stoppable: signal<boolean>(stoppable),
    busy,
    refresh: (): void => void calls.push('refresh'),
    start: (): void => void calls.push('start'),
    stop: (): void => void calls.push('stop'),
  };
  return { handler, calls, busy };
}

describe('ModelManagerCommands', () => {
  it('reports safe defaults when no view is active', () => {
    const commands: ModelManagerCommands = new ModelManagerCommands();

    expect(commands.running()).toBe(false);
    expect(commands.stoppable()).toBe(false);
    expect(commands.busy()).toBe(false);
  });

  it('is a no-op when no view is active, rather than throwing', () => {
    const commands: ModelManagerCommands = new ModelManagerCommands();

    expect((): void => {
      commands.refresh();
      commands.start();
      commands.stop();
    }).not.toThrow();
  });

  it('forwards each action to the registered handler', () => {
    const commands: ModelManagerCommands = new ModelManagerCommands();
    const { handler, calls } = handlerWith();
    commands.register(handler);

    commands.refresh();
    commands.start();
    commands.stop();

    expect(calls).toEqual(['refresh', 'start', 'stop']);
  });

  it('reads its state through the registered handler', () => {
    const commands: ModelManagerCommands = new ModelManagerCommands();
    const { handler, busy } = handlerWith(true, true);
    commands.register(handler);

    expect(commands.running()).toBe(true);
    expect(commands.stoppable()).toBe(true);

    busy.set(true);
    expect(commands.busy()).toBe(true);
  });

  it('distinguishes a running server from one Studio may stop', () => {
    const commands: ModelManagerCommands = new ModelManagerCommands();
    // The user's own Ollama: reachable, but not Studio's to kill.
    commands.register(handlerWith(true, false).handler);

    expect(commands.running()).toBe(true);
    expect(commands.stoppable()).toBe(false);
  });

  it('clears only its own handler on unregister', () => {
    const commands: ModelManagerCommands = new ModelManagerCommands();
    const first: ModelManagerCommandHandler = handlerWith(true, true).handler;
    const second: ModelManagerCommandHandler = handlerWith(true, true).handler;

    commands.register(first);
    commands.register(second);
    commands.unregister(first); // a stale view deregistering must not blank the current one

    expect(commands.running()).toBe(true);

    commands.unregister(second);
    expect(commands.running()).toBe(false);
  });
});
