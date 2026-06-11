import { TestBed } from '@angular/core/testing';

import { TerminalCommandHandler, TerminalCommands } from './terminal-commands';

/**
 * Creates a command handler whose methods record whether they were invoked.
 * @param calls A record the handler marks when each command is invoked.
 * @returns Returns the recording handler.
 */
function createHandler(calls: Record<string, boolean>): TerminalCommandHandler {
  return {
    copy: (): void => void (calls['copy'] = true),
    paste: (): void => void (calls['paste'] = true),
    clear: (): void => void (calls['clear'] = true),
    nuke: (): void => void (calls['nuke'] = true),
  };
}

describe('TerminalCommands', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(TestBed.inject(TerminalCommands)).toBeTruthy();
  });

  it('hasActiveTerminal_whenNoHandlerRegistered_isFalse', () => {
    expect(TestBed.inject(TerminalCommands).hasActiveTerminal()).toBe(false);
  });

  it('copy_whenHandlerRegistered_forwardsToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean> = {};
    commands.register(createHandler(calls));

    commands.copy();

    expect(calls['copy']).toBe(true);
    expect(commands.hasActiveTerminal()).toBe(true);
  });

  it('nuke_whenHandlerUnregistered_doesNothing', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean> = {};
    const handler: TerminalCommandHandler = createHandler(calls);
    commands.register(handler);
    commands.unregister(handler);

    commands.nuke();

    expect(calls['nuke']).toBeUndefined();
    expect(commands.hasActiveTerminal()).toBe(false);
  });
});
