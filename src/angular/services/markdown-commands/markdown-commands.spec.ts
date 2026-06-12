import { TestBed } from '@angular/core/testing';

import { MarkdownCommandHandler, MarkdownCommands } from './markdown-commands';

/**
 * Builds a command handler whose every method records that it was invoked.
 * @param calls The set that records invoked method names.
 * @returns Returns the recording handler.
 */
function recordingHandler(calls: Set<string>): MarkdownCommandHandler {
  return {
    toggleBold: (): void => void calls.add('toggleBold'),
    toggleItalic: (): void => void calls.add('toggleItalic'),
    toggleStrikethrough: (): void => void calls.add('toggleStrikethrough'),
    toggleInlineCode: (): void => void calls.add('toggleInlineCode'),
    toggleBulletList: (): void => void calls.add('toggleBulletList'),
    toggleOrderedList: (): void => void calls.add('toggleOrderedList'),
    insertTable: (): void => void calls.add('insertTable'),
    insertHorizontalRule: (): void => void calls.add('insertHorizontalRule'),
    setBlockType: (): void => void calls.add('setBlockType'),
  };
}

describe('MarkdownCommands', () => {
  let commands: MarkdownCommands;

  beforeEach(() => {
    commands = TestBed.inject(MarkdownCommands);
  });

  it('hasActiveEditor_whenNoHandlerRegistered_returnsFalse', () => {
    expect(commands.hasActiveEditor()).toBe(false);
  });

  it('register_whenHandlerRegistered_marksEditorActive', () => {
    commands.register(recordingHandler(new Set<string>()));
    expect(commands.hasActiveEditor()).toBe(true);
  });

  it('toggleBold_whenHandlerRegistered_forwardsToHandler', () => {
    const calls: Set<string> = new Set<string>();
    commands.register(recordingHandler(calls));
    commands.toggleBold();
    expect(calls.has('toggleBold')).toBe(true);
  });

  it('toggleBold_whenNoHandlerRegistered_doesNothing', () => {
    expect((): void => commands.toggleBold()).not.toThrow();
  });

  it('unregister_whenHandlerMatches_clearsActiveEditor', () => {
    const handler: MarkdownCommandHandler = recordingHandler(new Set<string>());
    commands.register(handler);
    commands.unregister(handler);
    expect(commands.hasActiveEditor()).toBe(false);
  });

  it('unregister_whenHandlerDiffers_keepsActiveEditor', () => {
    commands.register(recordingHandler(new Set<string>()));
    commands.unregister(recordingHandler(new Set<string>()));
    expect(commands.hasActiveEditor()).toBe(true);
  });

  it('setActiveBlockType_whenCalled_updatesActiveBlockType', () => {
    commands.setActiveBlockType('heading-2');
    expect(commands.activeBlockType()).toBe('heading-2');
  });

  it('register_whenHandlerRegistered_resetsActiveBlockTypeToParagraph', () => {
    commands.setActiveBlockType('heading-2');
    commands.register(recordingHandler(new Set<string>()));
    expect(commands.activeBlockType()).toBe('paragraph');
  });
});
