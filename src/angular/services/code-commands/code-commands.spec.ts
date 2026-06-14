import { TestBed } from '@angular/core/testing';

import { CodeCommandHandler, CodeCommands } from './code-commands';

/**
 * Builds the no-op ribbon command methods shared by the test handlers.
 * @param calls The set that records invoked method names.
 * @returns Returns the recording command methods.
 */
function recordingCommands(calls: Set<string>): Omit<CodeCommandHandler, 'getText' | 'replaceText'> {
  return {
    cut: (): void => void calls.add('cut'),
    copy: (): void => void calls.add('copy'),
    paste: (): void => void calls.add('paste'),
    undo: (): void => void calls.add('undo'),
    redo: (): void => void calls.add('redo'),
    find: (): void => void calls.add('find'),
    formatDocument: (): void => void calls.add('formatDocument'),
    save: (): void => void calls.add('save'),
    saveAs: (): void => void calls.add('saveAs'),
  };
}

/**
 * Builds a command handler whose every ribbon method records that it was invoked, and whose text is
 * backed by a mutable string.
 * @param calls The set that records invoked method names.
 * @param initial The initial document text.
 * @returns Returns the recording handler.
 */
function recordingHandler(calls: Set<string>, initial: string = ''): CodeCommandHandler {
  let text: string = initial;
  return {
    ...recordingCommands(calls),
    getText: (): string => text,
    replaceText: (value: string): void => {
      text = value;
    },
  };
}

describe('CodeCommands', () => {
  let commands: CodeCommands;

  beforeEach(() => {
    commands = TestBed.inject(CodeCommands);
  });

  it('hasActiveEditor_whenNoHandlerRegistered_returnsFalse', () => {
    expect(commands.hasActiveEditor()).toBe(false);
  });

  it('register_whenHandlerRegistered_marksEditorActive', () => {
    commands.register(recordingHandler(new Set<string>()));
    expect(commands.hasActiveEditor()).toBe(true);
  });

  it('formatDocument_whenHandlerRegistered_forwardsToHandler', () => {
    const calls: Set<string> = new Set<string>();
    commands.register(recordingHandler(calls));
    commands.formatDocument();
    expect(calls.has('formatDocument')).toBe(true);
  });

  it('cut_whenNoHandlerRegistered_doesNothing', () => {
    expect((): void => commands.cut()).not.toThrow();
  });

  it('unregister_whenHandlerMatches_clearsActiveEditor', () => {
    const handler: CodeCommandHandler = recordingHandler(new Set<string>());
    commands.register(handler);
    commands.unregister(handler);
    expect(commands.hasActiveEditor()).toBe(false);
  });

  it('readActiveText_whenHandlerRegistered_returnsTheHandlerText', () => {
    commands.register(recordingHandler(new Set<string>(), 'hello'));
    expect(commands.readActiveText()).toBe('hello');
  });

  it('readActiveText_whenNoHandlerEverRegistered_returnsNull', () => {
    expect(commands.readActiveText()).toBeNull();
  });

  it('replaceActiveText_whenHandlerRegistered_replacesAndReturnsTrue', () => {
    commands.register(recordingHandler(new Set<string>(), 'old'));
    expect(commands.replaceActiveText('new')).toBe(true);
    expect(commands.readActiveText()).toBe('new');
  });

  it('replaceActiveText_whenNoHandler_returnsFalse', () => {
    expect(commands.replaceActiveText('x')).toBe(false);
  });

  it('readActiveText_whenHandlerUnregistered_stillReadsTheLastHandler', () => {
    const handler: CodeCommandHandler = recordingHandler(new Set<string>(), 'sticky');
    commands.register(handler);
    commands.unregister(handler);
    expect(commands.hasActiveEditor()).toBe(false);
    expect(commands.readActiveText()).toBe('sticky');
  });

  it('readActiveText_whenHandlerForgotten_returnsNull', () => {
    const handler: CodeCommandHandler = recordingHandler(new Set<string>(), 'gone');
    commands.register(handler);
    commands.forget(handler);
    expect(commands.readActiveText()).toBeNull();
  });
});
