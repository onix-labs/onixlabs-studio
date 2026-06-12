import { TestBed } from '@angular/core/testing';

import { CodeCommandHandler, CodeCommands } from './code-commands';

/**
 * Builds a command handler whose every method records that it was invoked.
 * @param calls The set that records invoked method names.
 * @returns Returns the recording handler.
 */
function recordingHandler(calls: Set<string>): CodeCommandHandler {
  return {
    cut: (): void => void calls.add('cut'),
    copy: (): void => void calls.add('copy'),
    paste: (): void => void calls.add('paste'),
    undo: (): void => void calls.add('undo'),
    redo: (): void => void calls.add('redo'),
    find: (): void => void calls.add('find'),
    formatDocument: (): void => void calls.add('formatDocument'),
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
});
