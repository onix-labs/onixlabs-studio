import { TestBed } from '@angular/core/testing';

import { EditorCommandHandler, EditorCommands } from './editor-commands';

/**
 * Builds the no-op ribbon command methods shared by the test handlers.
 * @param calls The set that records invoked method names.
 * @returns Returns the recording command methods.
 */
function recordingCommands(
  calls: Set<string>,
): Omit<EditorCommandHandler, 'getText' | 'getSelectionText' | 'replaceText' | 'replaceRange'> {
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
function recordingHandler(calls: Set<string>, initial: string = ''): EditorCommandHandler {
  let text: string = initial;
  return {
    ...recordingCommands(calls),
    getText: (): string => text,
    getSelectionText: (): string => '',
    replaceText: (value: string): void => {
      text = value;
    },
    replaceRange: (start: number, length: number, value: string): void => {
      text = text.slice(0, start) + value + text.slice(start + length);
    },
  };
}

describe('EditorCommands', () => {
  let commands: EditorCommands;

  beforeEach(() => {
    commands = TestBed.inject(EditorCommands);
  });

  it('hasActiveEditor_whenNoHandlerRegistered_returnsFalse', () => {
    expect(commands.hasActiveEditor()).toBe(false);
  });

  it('register_whenHandlerRegistered_marksEditorActive', () => {
    commands.register('tab-1', recordingHandler(new Set<string>()));
    expect(commands.hasActiveEditor()).toBe(true);
  });

  it('formatDocument_whenHandlerRegistered_forwardsToHandler', () => {
    const calls: Set<string> = new Set<string>();
    commands.register('tab-1', recordingHandler(calls));
    commands.formatDocument();
    expect(calls.has('formatDocument')).toBe(true);
  });

  it('cut_whenNoHandlerRegistered_doesNothing', () => {
    expect((): void => commands.cut()).not.toThrow();
  });

  it('deactivate_whenActiveTab_clearsActiveEditor', () => {
    commands.register('tab-1', recordingHandler(new Set<string>()));
    commands.deactivate('tab-1');
    expect(commands.hasActiveEditor()).toBe(false);
  });

  it('readActiveSelection_whenTheLastEditorHasASelection_returnsItEvenAfterDeactivation', () => {
    const handler: EditorCommandHandler = {
      ...recordingHandler(new Set<string>()),
      getSelectionText: (): string => 'const answer = 42;',
    };
    commands.register('tab-1', handler);
    // The user focuses the agent panel: the editor deactivates but stays the last-active target.
    commands.deactivate('tab-1');

    expect(commands.readActiveSelection()).toEqual({
      tabId: 'tab-1',
      text: 'const answer = 42;',
    });
  });

  it('readActiveSelection_whenNothingIsSelectedOrNoEditor_returnsNull', () => {
    expect(commands.readActiveSelection()).toBeNull();

    commands.register('tab-1', recordingHandler(new Set<string>()));
    expect(commands.readActiveSelection()).toBeNull();
  });

  it('readText_readsTheGivenTabsEditorRegardlessOfWhichIsActive', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'one'));
    commands.register('tab-2', recordingHandler(new Set<string>(), 'two'));
    // tab-2 registered last and is active, but the agent for tab-1 still reads tab-1.
    expect(commands.readText('tab-1')).toBe('one');
    expect(commands.readText('tab-2')).toBe('two');
  });

  it('replaceText_replacesTheGivenTabsEditor', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'old'));
    expect(commands.replaceText('tab-1', 'new')).toBe(true);
    expect(commands.readText('tab-1')).toBe('new');
  });

  it('replaceText_whenTabNotRegistered_returnsFalse', () => {
    expect(commands.replaceText('missing', 'x')).toBe(false);
  });

  it('readText_whenTabDeactivated_stillReadsItsEditor', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'kept'));
    commands.deactivate('tab-1');
    expect(commands.readText('tab-1')).toBe('kept');
  });

  it('readText_whenTabForgotten_returnsNull', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'gone'));
    commands.forget('tab-1');
    expect(commands.readText('tab-1')).toBeNull();
  });

  it('readActiveText_whenHandlerRegistered_returnsTheHandlerText', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'hello'));
    expect(commands.readActiveText()).toBe('hello');
  });

  it('readActiveText_whenNoHandlerEverRegistered_returnsNull', () => {
    expect(commands.readActiveText()).toBeNull();
  });

  it('replaceActiveText_whenHandlerRegistered_replacesAndReturnsTrue', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'old'));
    expect(commands.replaceActiveText('new')).toBe(true);
    expect(commands.readActiveText()).toBe('new');
  });

  it('replaceActiveText_whenNoHandler_returnsFalse', () => {
    expect(commands.replaceActiveText('x')).toBe(false);
  });

  it('readActiveText_whenTabDeactivated_stillReadsTheLastHandler', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'sticky'));
    commands.deactivate('tab-1');
    expect(commands.hasActiveEditor()).toBe(false);
    expect(commands.readActiveText()).toBe('sticky');
  });

  it('readActiveText_whenHandlerForgotten_returnsNull', () => {
    commands.register('tab-1', recordingHandler(new Set<string>(), 'gone'));
    commands.forget('tab-1');
    expect(commands.readActiveText()).toBeNull();
  });
});
