import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  MarkdownCommandHandler,
  MarkdownCommands,
} from '@shared/angular/services/markdown-commands/markdown-commands';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { Documents } from '@shared/angular/services/documents/documents';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MarkdownRibbon } from './markdown-ribbon';

/**
 * Builds a no-op command handler that records the markdown passed to its insert primitives.
 * @param inserted The list that captures inserted markdown, tagged by primitive.
 * @returns Returns the recording handler.
 */
function recordingHandler(inserted: string[]): MarkdownCommandHandler {
  const noop: () => void = (): void => undefined;
  return {
    cut: noop,
    cutAsPlaintext: noop,
    copy: noop,
    copyAsPlaintext: noop,
    paste: noop,
    pasteAsPlaintext: noop,
    pasteAsCode: noop,
    undo: (): void => void inserted.push('undo'),
    redo: (): void => void inserted.push('redo'),
    toggleBold: noop,
    toggleItalic: noop,
    toggleStrikethrough: noop,
    toggleInlineCode: noop,
    toggleBulletList: (): void => void inserted.push('bullet-list'),
    toggleOrderedList: (): void => void inserted.push('ordered-list'),
    toggleTaskList: (): void => void inserted.push('task-list'),
    insertTable: (): void => void inserted.push('table'),
    insertHorizontalRule: (): void => void inserted.push('divider'),
    insertMarkdown: (markdown: string): void => void inserted.push(`block:${markdown}`),
    insertInlineMarkdown: (markdown: string): void => void inserted.push(`inline:${markdown}`),
    insertText: (text: string): void => void inserted.push(`text:${text}`),
    appendMarkdown: (markdown: string): void => void inserted.push(`append:${markdown}`),
    setBlockType: noop,
    goToHeading: noop,
    readDocument: (): string => '',
    replaceDocument: noop,
  };
}

describe('MarkdownRibbon', () => {
  let component: MarkdownRibbon;
  let fixture: ComponentFixture<MarkdownRibbon>;
  let element: HTMLElement;
  let windows: FakeModalWindows;

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [MarkdownRibbon],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownRibbon);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('editGroup_whenRendered_isLabelledEdit', () => {
    const titles: string[] = Array.from(element.querySelectorAll('.ribbon-group__title')).map(
      (title: Element): string => title.textContent?.trim() ?? '',
    );

    expect(titles).toContain('Edit');
    expect(titles).not.toContain('Clipboard');
  });

  it('groups_whenRendered_includeListsBlocksMediaInline', () => {
    const titles: string[] = Array.from(element.querySelectorAll('.ribbon-group__title')).map(
      (title: Element): string => title.textContent?.trim() ?? '',
    );

    expect(titles).toContain('Lists');
    expect(titles).toContain('Blocks');
    expect(titles).toContain('Media');
    expect(titles).toContain('Inline');
    expect(titles).not.toContain('Insert');
  });

  it('undoButton_whenHistoryAvailable_undoes', () => {
    const inserted: string[] = [];
    const commands: MarkdownCommands = TestBed.inject(MarkdownCommands);
    commands.register('doc-1', recordingHandler(inserted));
    commands.setHistoryState(true, false);
    fixture.detectChanges();

    smallButton('Undo').click();

    expect(inserted).toContain('undo');
  });

  it('undoButton_whenNoHistory_isDisabled', () => {
    TestBed.inject(MarkdownCommands).setHistoryState(false, false);
    fixture.detectChanges();

    expect(smallButton('Undo').disabled).toBe(true);
  });

  it('tableButton_whenClicked_insertsATable', () => {
    const inserted: string[] = [];
    const commands: MarkdownCommands = TestBed.inject(MarkdownCommands);
    commands.register('doc-1', recordingHandler(inserted));

    smallButton('Table').click();

    expect(inserted).toContain('table');
  });

  it('bulletsButton_whenClicked_insertsABulletedList', () => {
    const inserted: string[] = [];
    const commands: MarkdownCommands = TestBed.inject(MarkdownCommands);
    commands.register('doc-1', recordingHandler(inserted));

    smallButton('Bullets').click();

    expect(inserted).toContain('bullet-list');
  });

  it('outlineButton_whenClicked_togglesTheOutlinePanel', () => {
    const panels: MarkdownPanels = TestBed.inject(MarkdownPanels);
    // The ribbon toggles the focused document's panel; simulate an active markdown document.
    panels.setActiveDocument('doc-1');
    // The Outline toggle is only enabled when the document has headings to outline.
    TestBed.inject(MarkdownCommands).setOutline([{ id: 'h1', level: 1, text: 'Title', index: 0 }]);
    fixture.detectChanges();
    expect(panels.active().has('outline')).toBe(false);

    toolButton('Outline').click();

    expect(panels.active().has('outline')).toBe(true);
  });

  it('outlineButton_whenNoHeadings_isDisabled', () => {
    TestBed.inject(MarkdownCommands).setOutline([]);
    fixture.detectChanges();

    expect(toolButton('Outline').disabled).toBe(true);
  });

  it('outlineButton_whenHeadingsPresent_isEnabled', () => {
    TestBed.inject(MarkdownCommands).setOutline([{ id: 'h1', level: 1, text: 'Title', index: 0 }]);
    fixture.detectChanges();

    expect(toolButton('Outline').disabled).toBe(false);
  });

  it('reviewAndReaderButtons_whenDocumentEmpty_areDisabled', () => {
    openMarkdownTab('   \n  ');

    expect(toolButton('Review').disabled).toBe(true);
    expect(toolButton('Reader').disabled).toBe(true);
  });

  it('reviewAndReaderButtons_whenDocumentHasContent_areEnabled', () => {
    openMarkdownTab('Some prose worth reading.');

    expect(toolButton('Review').disabled).toBe(false);
    expect(toolButton('Reader').disabled).toBe(false);
  });

  it('imageButton_whenClicked_opensTheImageModal', () => {
    // A modal is presented in its own window, so opening one is observed as a window opening rather
    // than an inline overlay appearing.
    expect(windows.openWindows).toBe(0);

    smallButton('Image').click();
    fixture.detectChanges();

    expect(windows.openWindows).toBe(1);
  });

  /**
   * Finds a small ribbon button by its label.
   * @param label The button's label text.
   * @returns Returns the matching button.
   */
  function smallButton(label: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.ribbon-button-small'),
    );
    return buttons.find(
      (button: HTMLButtonElement): boolean =>
        button.querySelector('span')?.textContent?.trim() === label,
    )!;
  }

  /**
   * Finds a large ribbon button by its label.
   * @param label The button's label text.
   * @returns Returns the matching button.
   */
  function toolButton(label: string): HTMLButtonElement {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('.ribbon-button')).find(
      (button: HTMLButtonElement): boolean =>
        button.querySelector('span')?.textContent?.trim() === label,
    )!;
  }

  /**
   * Opens and activates a markdown tab with the given content, so the ribbon resolves a non/empty
   * active document.
   * @param content The document's markdown content.
   * @returns Returns the opened tab's id.
   */
  function openMarkdownTab(content: string): string {
    const tabs: Tabs = TestBed.inject(Tabs);
    const documents: Documents = TestBed.inject(Documents);
    const id: string = tabs.open('markdown').id;
    tabs.activate(id);
    documents.ensure(id);
    documents.setContent(id, content);
    fixture.detectChanges();
    return id;
  }
});
