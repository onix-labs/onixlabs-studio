import { TestBed } from '@angular/core/testing';

import {
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
} from '@shared/api/ai-types';
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
    getSelectionText: (): string => '',
    replaceText: (value: string): void => {
      text = value;
    },
    replaceRange: (start: number, length: number, value: string): void => {
      text = text.slice(0, start) + value + text.slice(start + length);
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

  it('constructor_whenInstantiated_registersEditAndInsertCapabilities', () => {
    expect(registered.has(EDIT_ACTIVE_DOCUMENT)).toBe(true);
    expect(registered.has(INSERT_ACTIVE_DOCUMENT)).toBe(true);
  });

  it('edit_whenUniqueMatch_editsOnlyThatRegion', () => {
    editorCommands.register('tab-1', textHandler('const a = 1;\nconst b = 2;\n'));
    const edit: AiCapability | undefined = registered.get(EDIT_ACTIVE_DOCUMENT);

    const result: unknown = edit?.({
      tabId: 'tab-1',
      oldString: 'const b = 2;',
      newString: 'const b = 20;',
    });

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(editorCommands.readText('tab-1')).toBe('const a = 1;\nconst b = 20;\n');
  });

  it('edit_whenAnchorAmbiguous_failsWithoutChangingTheDocument', () => {
    editorCommands.register('tab-1', textHandler('aa aa'));
    const edit: AiCapability | undefined = registered.get(EDIT_ACTIVE_DOCUMENT);

    const result: unknown = edit?.({ tabId: 'tab-1', oldString: 'aa', newString: 'b' });

    expect((result as { ok: boolean; detail: string }).ok).toBe(false);
    expect((result as { detail: string }).detail).toContain('2 places');
    expect(editorCommands.readText('tab-1')).toBe('aa aa');
  });

  it('edit_whenReplaceAll_replacesEveryOccurrence', () => {
    editorCommands.register('tab-1', textHandler('x = x + x'));
    const edit: AiCapability | undefined = registered.get(EDIT_ACTIVE_DOCUMENT);

    const result: unknown = edit?.({
      tabId: 'tab-1',
      oldString: 'x',
      newString: 'y',
      replaceAll: true,
    });

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(editorCommands.readText('tab-1')).toBe('y = y + y');
  });

  it('edit_whenMarkdownEditorOwnsTheTab_editsTheMarkdownSource', () => {
    markdownCommands.register('doc-1', markdownHandler('# Title\n\nOld body.\n'));
    const edit: AiCapability | undefined = registered.get(EDIT_ACTIVE_DOCUMENT);

    const result: unknown = edit?.({
      tabId: 'doc-1',
      oldString: 'Old body.',
      newString: 'New body.',
    });

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(markdownCommands.readDocument('doc-1')).toBe('# Title\n\nNew body.\n');
  });

  it('insert_afterAnchor_insertsIntoTheDocument', () => {
    editorCommands.register('tab-1', textHandler('line one\nline three\n'));
    const insert: AiCapability | undefined = registered.get(INSERT_ACTIVE_DOCUMENT);

    const result: unknown = insert?.({
      tabId: 'tab-1',
      text: 'line two\n',
      placement: 'after',
      anchor: 'line one\n',
    });

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(editorCommands.readText('tab-1')).toBe('line one\nline two\nline three\n');
  });

  it('insert_atEnd_appendsToTheDocument', () => {
    editorCommands.register('tab-1', textHandler('body'));
    const insert: AiCapability | undefined = registered.get(INSERT_ACTIVE_DOCUMENT);

    const result: unknown = insert?.({ tabId: 'tab-1', text: '!', placement: 'end' });

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(editorCommands.readText('tab-1')).toBe('body!');
  });

  it('insert_whenNoEditor_reportsNoActiveDocument', () => {
    const insert: AiCapability | undefined = registered.get(INSERT_ACTIVE_DOCUMENT);

    const result: unknown = insert?.({ text: 'x', placement: 'end' });

    expect((result as { ok: boolean; detail: string }).ok).toBe(false);
    expect((result as { detail: string }).detail).toContain('No active document');
  });

  it('edit_whenUnscoped_editsTheFocusedEditor', () => {
    editorCommands.register('tab-1', textHandler('alpha beta'));
    const edit: AiCapability | undefined = registered.get(EDIT_ACTIVE_DOCUMENT);

    const result: unknown = edit?.({ oldString: 'beta', newString: 'gamma' });

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(editorCommands.readActiveText()).toBe('alpha gamma');
  });
});
