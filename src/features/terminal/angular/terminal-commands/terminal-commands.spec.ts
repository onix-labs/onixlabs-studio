import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TerminalCommandHandler, TerminalCommands } from './terminal-commands';

/**
 * Creates a command handler whose methods record whether they were invoked.
 * @param calls A record the handler marks when each command is invoked.
 * @returns Returns the recording handler.
 */
function createHandler(calls: Record<string, boolean>): TerminalCommandHandler {
  return {
    clear: (): void => void (calls['clear'] = true),
    restart: (): void => void (calls['restart'] = true),
    cut: (): void => void (calls['cut'] = true),
    copy: (): void => void (calls['copy'] = true),
    paste: (): void => void (calls['paste'] = true),
    list: (): void => void (calls['list'] = true),
    listAll: (): void => void (calls['listAll'] = true),
    open: (): void => void (calls['open'] = true),
    home: (): void => void (calls['home'] = true),
    root: (): void => void (calls['root'] = true),
    scrollLocked: signal<boolean>(false),
    setScrollLock: (): void => void (calls['setScrollLock'] = true),
    scrollToBottom: (): void => void (calls['scrollToBottom'] = true),
    newSession: (): void => void (calls['newSession'] = true),
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

  it('restart_whenHandlerRegistered_forwardsToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean> = {};
    commands.register(createHandler(calls));

    commands.restart();

    expect(calls['restart']).toBe(true);
    expect(commands.hasActiveTerminal()).toBe(true);
  });

  it('listAll_whenHandlerRegistered_forwardsToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean> = {};
    commands.register(createHandler(calls));

    commands.listAll();

    expect(calls['listAll']).toBe(true);
  });

  it('scrollLocked_reflectsTheActiveHandlerAndDefaultsFalse', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    expect(commands.scrollLocked()).toBe(false);

    const locked: WritableSignal<boolean> = signal<boolean>(false);
    commands.register({ ...createHandler({}), scrollLocked: locked });
    expect(commands.scrollLocked()).toBe(false);

    locked.set(true);
    expect(commands.scrollLocked()).toBe(true);
  });

  it('setScrollLock_whenHandlerRegistered_forwardsToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean> = {};
    commands.register(createHandler(calls));

    commands.setScrollLock(true);

    expect(calls['setScrollLock']).toBe(true);
  });

  it('newSession_whenHandlerRegistered_forwardsToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean> = {};
    commands.register(createHandler(calls));

    commands.newSession('/bin/zsh');

    expect(calls['newSession']).toBe(true);
  });

  it('open_whenHandlerUnregistered_doesNothing', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean> = {};
    const handler: TerminalCommandHandler = createHandler(calls);
    commands.register(handler);
    commands.unregister(handler);

    commands.open();

    expect(calls['open']).toBeUndefined();
    expect(commands.hasActiveTerminal()).toBe(false);
  });
});
