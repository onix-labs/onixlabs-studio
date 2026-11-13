import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ShellFamily, TerminalListing, TerminalLocation } from './shell-commands';
import { TerminalCommandHandler, TerminalCommands } from './terminal-commands';

/**
 * Creates a command handler whose methods record whether they were invoked.
 * @param calls A record the handler marks when each command is invoked.
 * @returns Returns the recording handler.
 */
function createHandler(calls: Record<string, boolean | string>): TerminalCommandHandler {
  return {
    shellFamily: signal<ShellFamily>('posix'),
    clear: (): void => void (calls['clear'] = true),
    restart: (): void => void (calls['restart'] = true),
    cut: (): void => void (calls['cut'] = true),
    copy: (): void => void (calls['copy'] = true),
    paste: (): void => void (calls['paste'] = true),
    list: (listing: TerminalListing): void => void (calls['list'] = listing),
    open: (): void => void (calls['open'] = true),
    goTo: (location: TerminalLocation): void => void (calls['goTo'] = location),
    scrollLocked: signal<boolean>(false),
    setScrollLock: (): void => void (calls['setScrollLock'] = true),
    scrollToBottom: (): void => void (calls['scrollToBottom'] = true),
    newSession: (): void => void (calls['newSession'] = true),
    find: (): void => void (calls['find'] = true),
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
    const calls: Record<string, boolean | string> = {};
    commands.register(createHandler(calls));

    commands.restart();

    expect(calls['restart']).toBe(true);
    expect(commands.hasActiveTerminal()).toBe(true);
  });

  it('list_whenHandlerRegistered_forwardsTheListingToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean | string> = {};
    commands.register(createHandler(calls));

    commands.list('all');

    expect(calls['list']).toBe('all');
  });

  it('goTo_whenHandlerRegistered_forwardsTheLocationToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean | string> = {};
    commands.register(createHandler(calls));

    commands.goTo('downloads');

    expect(calls['goTo']).toBe('downloads');
  });

  it('shellFamily_followsTheActiveHandlerAndIsNullWithoutOne', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    expect(commands.shellFamily()).toBeNull();

    const family: WritableSignal<ShellFamily> = signal<ShellFamily>('posix');
    commands.register({ ...createHandler({}), shellFamily: family });
    expect(commands.shellFamily()).toBe('posix');

    family.set('cmd');
    expect(commands.shellFamily()).toBe('cmd');
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
    const calls: Record<string, boolean | string> = {};
    commands.register(createHandler(calls));

    commands.setScrollLock(true);

    expect(calls['setScrollLock']).toBe(true);
  });

  it('newSession_whenHandlerRegistered_forwardsToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean | string> = {};
    commands.register(createHandler(calls));

    commands.newSession('/bin/zsh');

    expect(calls['newSession']).toBe(true);
  });

  it('find_whenHandlerRegistered_forwardsToTheHandler', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean | string> = {};
    commands.register(createHandler(calls));

    commands.find();

    expect(calls['find']).toBe(true);
  });

  it('open_whenHandlerUnregistered_doesNothing', () => {
    const commands: TerminalCommands = TestBed.inject(TerminalCommands);
    const calls: Record<string, boolean | string> = {};
    const handler: TerminalCommandHandler = createHandler(calls);
    commands.register(handler);
    commands.unregister(handler);

    commands.open();

    expect(calls['open']).toBeUndefined();
    expect(commands.hasActiveTerminal()).toBe(false);
  });
});
