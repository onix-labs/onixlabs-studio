import { TestBed } from '@angular/core/testing';

import { READ_ACTIVE_DOCUMENT, REPLACE_ACTIVE_DOCUMENT } from '@shared/api/ai-types';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import {
  EditorCommandHandler,
  EditorCommands,
} from '@shared/angular/services/editor-commands/editor-commands';
import {
  MarkdownCommandHandler,
  MarkdownCommands,
} from '@shared/angular/services/markdown-commands/markdown-commands';
import { AgentEditorCapabilities } from './agent-editor-capabilities';

/**
 * Builds a markdown command handler whose document text is backed by a mutable string and whose
 * commands are no-ops.
 * @param initial The initial markdown source.
 * @returns Returns the handler.
 */
function markdownHandler(initial: string): MarkdownCommandHandler {
  let document: string = initial;
  const noop: () => void = (): void => undefined;
  return {
    cut: noop,
    cutAsPlaintext: noop,
    copy: noop,
    copyAsPlaintext: noop,
    paste: noop,
    pasteAsPlaintext: noop,
    pasteAsCode: noop,
    undo: noop,
    redo: noop,
    toggleBold: noop,
    toggleItalic: noop,
    toggleStrikethrough: noop,
    toggleInlineCode: noop,
    toggleBulletList: noop,
    toggleOrderedList: noop,
    toggleTaskList: noop,
    insertTable: noop,
    insertHorizontalRule: noop,
    insertMarkdown: noop,
    insertInlineMarkdown: noop,
    insertText: noop,
    appendMarkdown: noop,
    setBlockType: noop,
    goToHeading: noop,
    readDocument: (): string => document,
    replaceDocument: (markdown: string): void => {
      document = markdown;
    },
  };
}

/**
 * Builds a code command handler whose text is backed by a mutable string and whose ribbon commands
 * are no-ops.
 * @param initial The initial text.
 * @returns Returns the handler.
 */
function textHandler(initial: string): EditorCommandHandler {
  let text: string = initial;
  return {
    cut: (): void => undefined,
    copy: (): void => undefined,
    paste: (): void => undefined,
    undo: (): void => undefined,
    redo: (): void => undefined,
    find: (): void => undefined,
    formatDocument: (): void => undefined,
    save: (): void => undefined,
    saveAs: (): void => undefined,
    getText: (): string => text,
    replaceText: (value: string): void => {
      text = value;
    },
  };
}

describe('AgentEditorCapabilities', () => {
  let registered: Map<string, AiCapability>;
  let editorCommands: EditorCommands;
  let markdownCommands: MarkdownCommands;

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    const runtimeStub: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        registered.set(name, handler);
        return (): void => undefined;
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AiRuntime, useValue: runtimeStub }],
    });
    editorCommands = TestBed.inject(EditorCommands);
    markdownCommands = TestBed.inject(MarkdownCommands);
    // Instantiate the service so it registers its capabilities.
    TestBed.inject(AgentEditorCapabilities);
  });

  it('constructor_whenInstantiated_registersReadAndReplaceCapabilities', () => {
    expect(registered.has(READ_ACTIVE_DOCUMENT)).toBe(true);
    expect(registered.has(REPLACE_ACTIVE_DOCUMENT)).toBe(true);
  });

  it('read_whenNoEditorActive_reportsUnavailable', () => {
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.(undefined)).toEqual({ available: false, text: '' });
  });

  it('read_whenEditorActive_returnsItsText', () => {
    editorCommands.register('tab-1', textHandler('hello'));
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.(undefined)).toEqual({ available: true, text: 'hello' });
  });

  it('read_whenMarkdownEditorActive_returnsItsLiveSource', () => {
    markdownCommands.register('doc-1', markdownHandler('# Live markdown'));
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.(undefined)).toEqual({ available: true, text: '# Live markdown' });
  });

  it('read_whenBothEditorsActive_prefersTheMarkdownEditor', () => {
    editorCommands.register('tab-1', textHandler('code text'));
    markdownCommands.register('doc-1', markdownHandler('# Markdown'));
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.(undefined)).toEqual({ available: true, text: '# Markdown' });
  });

  it('replace_whenEditorActive_updatesTheDocumentAndReportsOk', () => {
    editorCommands.register('tab-1', textHandler('old'));
    const replace: AiCapability | undefined = registered.get(REPLACE_ACTIVE_DOCUMENT);

    expect(replace?.({ text: 'new' })).toEqual({ ok: true });
    expect(editorCommands.readActiveText()).toBe('new');
  });

  it('replace_whenInputMalformed_reportsNotOk', () => {
    editorCommands.register('tab-1', textHandler('x'));
    const replace: AiCapability | undefined = registered.get(REPLACE_ACTIVE_DOCUMENT);

    expect(replace?.({})).toEqual({ ok: false });
  });

  it('replace_whenMarkdownEditorActive_updatesTheMarkdownDocument', () => {
    markdownCommands.register('doc-1', markdownHandler('# old'));
    const replace: AiCapability | undefined = registered.get(REPLACE_ACTIVE_DOCUMENT);

    expect(replace?.({ text: '# new' })).toEqual({ ok: true });
    expect(markdownCommands.readActiveDocument()).toBe('# new');
  });

  it('replace_whenBothEditorsActive_prefersTheMarkdownEditor', () => {
    editorCommands.register('tab-1', textHandler('code old'));
    markdownCommands.register('doc-1', markdownHandler('# md old'));
    const replace: AiCapability | undefined = registered.get(REPLACE_ACTIVE_DOCUMENT);

    expect(replace?.({ text: '# md new' })).toEqual({ ok: true });
    expect(markdownCommands.readActiveDocument()).toBe('# md new');
    expect(editorCommands.readActiveText()).toBe('code old');
  });

  it('read_whenTabIdGiven_readsThatTabNotTheActiveOne', () => {
    editorCommands.register('tab-1', textHandler('one'));
    editorCommands.register('tab-2', textHandler('two')); // tab-2 is active
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.({ tabId: 'tab-1' })).toEqual({ available: true, text: 'one' });
  });

  it('replace_whenTabIdGiven_writesToThatTabNotTheActiveOne', () => {
    editorCommands.register('tab-1', textHandler('one'));
    editorCommands.register('tab-2', textHandler('two')); // tab-2 is active
    const replace: AiCapability | undefined = registered.get(REPLACE_ACTIVE_DOCUMENT);

    expect(replace?.({ text: 'edited', tabId: 'tab-1' })).toEqual({ ok: true });
    expect(editorCommands.readText('tab-1')).toBe('edited');
    expect(editorCommands.readText('tab-2')).toBe('two');
  });

  it('read_whenTabIdUnknown_reportsUnavailable', () => {
    editorCommands.register('tab-1', textHandler('one'));
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.({ tabId: 'missing' })).toEqual({ available: false, text: '' });
  });
});
