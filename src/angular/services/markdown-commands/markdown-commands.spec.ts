import { TestBed } from '@angular/core/testing';

import { MarkdownCommandHandler, MarkdownCommands } from './markdown-commands';

/**
 * Builds a command handler whose every method records that it was invoked.
 * @param calls The set that records invoked method names.
 * @returns Returns the recording handler.
 */
function recordingHandler(calls: Set<string>): MarkdownCommandHandler {
  return {
    cut: (): void => void calls.add('cut'),
    cutAsPlaintext: (): void => void calls.add('cutAsPlaintext'),
    copy: (): void => void calls.add('copy'),
    copyAsPlaintext: (): void => void calls.add('copyAsPlaintext'),
    paste: (): void => void calls.add('paste'),
    pasteAsPlaintext: (): void => void calls.add('pasteAsPlaintext'),
    pasteAsCode: (): void => void calls.add('pasteAsCode'),
    undo: (): void => void calls.add('undo'),
    redo: (): void => void calls.add('redo'),
    toggleBold: (): void => void calls.add('toggleBold'),
    toggleItalic: (): void => void calls.add('toggleItalic'),
    toggleStrikethrough: (): void => void calls.add('toggleStrikethrough'),
    toggleInlineCode: (): void => void calls.add('toggleInlineCode'),
    toggleBulletList: (): void => void calls.add('toggleBulletList'),
    toggleOrderedList: (): void => void calls.add('toggleOrderedList'),
    insertTable: (): void => void calls.add('insertTable'),
    insertHorizontalRule: (): void => void calls.add('insertHorizontalRule'),
    insertMarkdown: (): void => void calls.add('insertMarkdown'),
    insertInlineMarkdown: (): void => void calls.add('insertInlineMarkdown'),
    insertText: (): void => void calls.add('insertText'),
    appendMarkdown: (): void => void calls.add('appendMarkdown'),
    setBlockType: (): void => void calls.add('setBlockType'),
    goToHeading: (): void => void calls.add('goToHeading'),
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

  it('clipboardCommands_whenHandlerRegistered_forwardToHandler', () => {
    const calls: Set<string> = new Set<string>();
    commands.register(recordingHandler(calls));
    commands.cut();
    commands.cutAsPlaintext();
    commands.copy();
    commands.copyAsPlaintext();
    commands.paste();
    commands.pasteAsPlaintext();
    commands.pasteAsCode();
    expect(calls.has('cut')).toBe(true);
    expect(calls.has('cutAsPlaintext')).toBe(true);
    expect(calls.has('copy')).toBe(true);
    expect(calls.has('copyAsPlaintext')).toBe(true);
    expect(calls.has('paste')).toBe(true);
    expect(calls.has('pasteAsPlaintext')).toBe(true);
    expect(calls.has('pasteAsCode')).toBe(true);
  });

  it('clipboardCommands_whenNoHandlerRegistered_doNothing', () => {
    expect((): void => commands.cut()).not.toThrow();
    expect((): void => commands.cutAsPlaintext()).not.toThrow();
    expect((): void => commands.copy()).not.toThrow();
    expect((): void => commands.copyAsPlaintext()).not.toThrow();
    expect((): void => commands.paste()).not.toThrow();
    expect((): void => commands.pasteAsPlaintext()).not.toThrow();
    expect((): void => commands.pasteAsCode()).not.toThrow();
  });

  it('insertCommands_whenHandlerRegistered_forwardToHandler', () => {
    const calls: Set<string> = new Set<string>();
    commands.register(recordingHandler(calls));
    commands.insertMarkdown('![](x)');
    commands.insertInlineMarkdown('[a](b)');
    commands.insertText('🙂');
    commands.appendMarkdown('[^1]: note');
    expect(calls.has('insertMarkdown')).toBe(true);
    expect(calls.has('insertInlineMarkdown')).toBe(true);
    expect(calls.has('insertText')).toBe(true);
    expect(calls.has('appendMarkdown')).toBe(true);
  });

  it('insertCommands_whenNoHandlerRegistered_doNothing', () => {
    expect((): void => commands.insertMarkdown('x')).not.toThrow();
    expect((): void => commands.insertInlineMarkdown('x')).not.toThrow();
    expect((): void => commands.insertText('x')).not.toThrow();
    expect((): void => commands.appendMarkdown('x')).not.toThrow();
  });

  it('historyCommands_whenHandlerRegistered_forwardToHandler', () => {
    const calls: Set<string> = new Set<string>();
    commands.register(recordingHandler(calls));
    commands.undo();
    commands.redo();
    expect(calls.has('undo')).toBe(true);
    expect(calls.has('redo')).toBe(true);
  });

  it('historyCommands_whenNoHandlerRegistered_doNothing', () => {
    expect((): void => commands.undo()).not.toThrow();
    expect((): void => commands.redo()).not.toThrow();
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

  it('setHistoryState_whenCalled_updatesCanUndoAndCanRedo', () => {
    commands.setHistoryState(true, false);
    expect(commands.canUndo()).toBe(true);
    expect(commands.canRedo()).toBe(false);
  });

  it('register_whenHandlerRegistered_resetsHistoryState', () => {
    commands.setHistoryState(true, true);
    commands.register(recordingHandler(new Set<string>()));
    expect(commands.canUndo()).toBe(false);
    expect(commands.canRedo()).toBe(false);
  });

  it('setOutline_whenCalled_updatesOutline', () => {
    commands.setOutline([{ id: 'heading-1', level: 1, text: 'Intro', pos: 0 }]);
    expect(commands.outline().length).toBe(1);
    expect(commands.outline()[0].text).toBe('Intro');
  });

  it('goToHeading_whenHandlerRegistered_forwardsToHandler', () => {
    const calls: Set<string> = new Set<string>();
    commands.register(recordingHandler(calls));
    commands.goToHeading(12);
    expect(calls.has('goToHeading')).toBe(true);
  });

  it('register_whenHandlerRegistered_resetsOutline', () => {
    commands.setOutline([{ id: 'heading-1', level: 1, text: 'Intro', pos: 0 }]);
    commands.register(recordingHandler(new Set<string>()));
    expect(commands.outline().length).toBe(0);
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
