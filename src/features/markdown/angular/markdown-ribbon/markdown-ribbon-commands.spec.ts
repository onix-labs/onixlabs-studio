import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';

import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { Documents } from '@shared/angular/services/documents/documents';
import {
  MarkdownCommandHandler,
  MarkdownCommands,
} from '@shared/angular/services/markdown-commands/markdown-commands';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Printing } from '@shared/angular/services/printing/printing';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MarkdownRibbon } from './markdown-ribbon';

/**
 * The ribbon's handlers its menus and modals call. Modals answer through windows the fake does not
 * render, so their submissions are made directly.
 */
interface RibbonHandlers {
  onCutVariant(id: string): void;
  onCopyVariant(id: string): void;
  onPasteVariant(id: string): void;
  onSaveVariant(id: string): void;
  onPrintVariant(id: string): void;
  onBlockChange(label: string): void;
  onImageSubmit(image: { url: string; alt: string }): void;
  onLinkSubmit(link: { url: string; text: string }): void;
  onMathSubmit(math: { expression: string; block: boolean }): void;
  onFootnoteSubmit(footnote: { label: string; content: string }): void;
  onCollapseSubmit(collapse: { summary: string; body: string }): void;
  onEmojiSubmit(emoji: string): void;
  onTableSubmit(table: { rows: number; columns: number }): void;
}

/**
 * Records what the editor was asked to insert, and the name of anything else it was asked to do.
 */
function recorder(log: string[]): MarkdownCommandHandler {
  const named: (name: string) => () => void = (name: string): (() => void) => {
    return (): void => void log.push(name);
  };
  return {
    cut: named('cut'),
    cutAsPlaintext: named('cutAsPlaintext'),
    copy: named('copy'),
    copyAsPlaintext: named('copyAsPlaintext'),
    paste: named('paste'),
    pasteAsPlaintext: named('pasteAsPlaintext'),
    pasteAsCode: named('pasteAsCode'),
    undo: named('undo'),
    redo: named('redo'),
    toggleBold: named('bold'),
    toggleItalic: named('italic'),
    toggleStrikethrough: named('strikethrough'),
    toggleInlineCode: named('inlineCode'),
    toggleBulletList: named('bullets'),
    toggleOrderedList: named('numbers'),
    toggleTaskList: named('tasks'),
    insertTable: (rows: number, columns: number): void => void log.push(`table:${rows}x${columns}`),
    insertHorizontalRule: named('divider'),
    insertMarkdown: (markdown: string): void => void log.push(`block:${markdown}`),
    insertInlineMarkdown: (markdown: string): void => void log.push(`inline:${markdown}`),
    insertText: (text: string): void => void log.push(`text:${text}`),
    appendMarkdown: (markdown: string): void => void log.push(`append:${markdown}`),
    setBlockType: (type: string): void => void log.push(`block-type:${type}`),
    goToHeading: named('heading'),
    readDocument: (): string => '',
    replaceDocument: named('replace'),
  };
}

describe('MarkdownRibbon commands', () => {
  let fixture: ComponentFixture<MarkdownRibbon>;
  let handlers: RibbonHandlers;
  let log: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownRibbon],
      providers: [{ provide: ModalWindows, useValue: new FakeModalWindows() }],
    }).compileComponents();
    fixture = TestBed.createComponent(MarkdownRibbon);
    await fixture.whenStable();
    handlers = fixture.componentInstance as unknown as RibbonHandlers;
    log = [];
    TestBed.inject(MarkdownCommands).register('doc-1', recorder(log));
    TestBed.tick();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('variants_runTheCommandTheyName', () => {
    handlers.onCutVariant('plaintext');
    handlers.onCutVariant('markdown');
    handlers.onCopyVariant('plaintext');
    handlers.onCopyVariant('markdown');
    handlers.onPasteVariant('plaintext');
    handlers.onPasteVariant('code');
    handlers.onPasteVariant('markdown');

    expect(log).toEqual([
      'cutAsPlaintext',
      'cut',
      'copyAsPlaintext',
      'copy',
      'pasteAsPlaintext',
      'pasteAsCode',
      'paste',
    ]);
  });

  it('saveVariants_saveOrSaveAs', () => {
    const documents: Documents = TestBed.inject(Documents);
    const save: MockInstance<Documents['saveActive']> = vi
      .spyOn(documents, 'saveActive')
      .mockResolvedValue(true);
    const saveAs: MockInstance<Documents['saveActiveAs']> = vi
      .spyOn(documents, 'saveActiveAs')
      .mockResolvedValue(true);

    handlers.onSaveVariant('save');
    expect(save).toHaveBeenCalledOnce();

    handlers.onSaveVariant('save-as');
    expect(saveAs).toHaveBeenCalledOnce();
  });

  it('printVariants_printOrExportTheActiveDocumentByName', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    const documents: Documents = TestBed.inject(Documents);
    const id: string = tabs.open('markdown').id;
    tabs.activate(id);
    const name: string = documents.ensure(id).fileName();
    const printing: Printing = TestBed.inject(Printing);
    const print: MockInstance<Printing['print']> = vi
      .spyOn(printing, 'print')
      .mockResolvedValue({ success: true });
    const exportPdf: MockInstance<Printing['exportPdf']> = vi
      .spyOn(printing, 'exportPdf')
      .mockResolvedValue({ success: true });

    handlers.onPrintVariant('print');
    handlers.onPrintVariant('export-pdf');

    expect(print.mock.calls[0]?.[0]).toBe(name);
    expect(exportPdf.mock.calls[0]?.[0]).toBe(name);
  });

  it('blockChange_ofAKnownLabel_setsTheBlock_andAnUnknownOneIsIgnored', () => {
    handlers.onBlockChange('Heading 1');
    handlers.onBlockChange('Nonsense');

    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^block-type:/);
  });

  it('imageSubmit_writesAMarkdownImage', () => {
    handlers.onImageSubmit({ url: 'https://x.test/a.png', alt: 'A' });

    expect(log).toEqual(['block:![A](https://x.test/a.png)']);
  });

  it('imageSubmit_ofAPathWithSpaces_staysAnImage', () => {
    handlers.onImageSubmit({ url: '/Users/me/My Photos/a (1).png', alt: 'A' });

    expect(log).toEqual(['block:![A](</Users/me/My Photos/a (1).png>)']);
  });

  it('linkSubmit_withoutText_usesTheUrl', () => {
    handlers.onLinkSubmit({ url: 'https://x.test', text: '' });

    expect(log).toEqual(['inline:[https://x.test](https://x.test)']);
  });

  it('linkSubmit_ofAPathWithSpaces_staysALink', () => {
    handlers.onLinkSubmit({ url: 'docs/read me.md', text: 'Notes' });

    expect(log).toEqual(['inline:[Notes](<docs/read me.md>)']);
  });

  it('mathSubmit_blockOrInline', () => {
    handlers.onMathSubmit({ expression: 'x^2', block: true });
    handlers.onMathSubmit({ expression: 'y', block: false });

    expect(log).toEqual(['block:$$\nx^2\n$$', 'inline:$y$']);
  });

  it('footnoteSubmit_slugsItsLabelAndAppendsTheNote', () => {
    handlers.onFootnoteSubmit({ label: 'my note', content: 'text' });

    expect(log).toEqual(['inline:[^my-note]', 'append:[^my-note]: text']);
  });

  it('footnoteSubmit_withoutALabel_numbersThem', () => {
    handlers.onFootnoteSubmit({ label: '', content: 'a' });
    handlers.onFootnoteSubmit({ label: '', content: 'b' });

    expect(log.filter((entry: string): boolean => entry.startsWith('inline:'))).toEqual([
      'inline:[^fn-1]',
      'inline:[^fn-2]',
    ]);
  });

  it('collapseSubmit_writesAnOpenDetailsBlock', () => {
    handlers.onCollapseSubmit({ summary: 'More', body: 'text' });

    expect(log).toEqual(['block:<details open>\n<summary>More</summary>\n\ntext\n\n</details>']);
  });

  it('emojiAndTable_insertWhatWasChosen', () => {
    handlers.onEmojiSubmit('😀');
    handlers.onTableSubmit({ rows: 2, columns: 3 });

    expect(log).toEqual(['text:😀', 'table:2x3']);
  });

  it('menu_formatAndInsertItems_reachTheEditor', () => {
    const menu: AppMenu = TestBed.inject(AppMenu);

    menu.dispatch('markdown.bold');
    menu.dispatch('markdown.italic');
    menu.dispatch('markdown.strikethrough');
    menu.dispatch('markdown.inlineCode');
    menu.dispatch('markdown.diagram');

    expect(log.slice(0, 4)).toEqual(['bold', 'italic', 'strikethrough', 'inlineCode']);
    expect(log[4]).toContain('```mermaid');
  });

  it.each(['outline', 'review', 'reader', 'agent', 'find'])(
    'menu_%s_togglesItsPanel',
    (panel: string) => {
      const toggle: MockInstance<MarkdownPanels['toggle']> = vi.spyOn(
        TestBed.inject(MarkdownPanels),
        'toggle',
      );

      TestBed.inject(AppMenu).dispatch(`markdown.${panel}`);

      expect(toggle).toHaveBeenCalledWith(panel);
    },
  );
});
