import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  MarkdownCommandHandler,
  MarkdownCommands,
} from '../../../../../services/markdown-commands/markdown-commands';
import { MarkdownPanels } from '../../../../../services/markdown-panels/markdown-panels';
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
    insertTable: (): void => void inserted.push('table'),
    insertHorizontalRule: (): void => void inserted.push('divider'),
    insertMarkdown: (markdown: string): void => void inserted.push(`block:${markdown}`),
    insertInlineMarkdown: (markdown: string): void => void inserted.push(`inline:${markdown}`),
    insertText: (text: string): void => void inserted.push(`text:${text}`),
    appendMarkdown: (markdown: string): void => void inserted.push(`append:${markdown}`),
    setBlockType: noop,
  };
}

describe('MarkdownRibbon', () => {
  let component: MarkdownRibbon;
  let fixture: ComponentFixture<MarkdownRibbon>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownRibbon],
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
    commands.register(recordingHandler(inserted));
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
    commands.register(recordingHandler(inserted));

    smallButton('Table').click();

    expect(inserted).toContain('table');
  });

  it('bulletsButton_whenClicked_insertsABulletedList', () => {
    const inserted: string[] = [];
    const commands: MarkdownCommands = TestBed.inject(MarkdownCommands);
    commands.register(recordingHandler(inserted));

    smallButton('Bullets').click();

    expect(inserted).toContain('bullet-list');
  });

  it('outlineButton_whenClicked_togglesTheOutlinePanel', () => {
    const panels: MarkdownPanels = TestBed.inject(MarkdownPanels);
    expect(panels.active()).toBe('none');

    const outline: HTMLButtonElement = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.ribbon-button'),
    ).find(
      (button: HTMLButtonElement): boolean => button.querySelector('span')?.textContent?.trim() === 'Outline',
    )!;
    outline.click();

    expect(panels.active()).toBe('outline');
  });

  it('imageButton_whenClicked_opensTheImageModal', () => {
    expect(element.querySelector('.modal--visible')).toBeNull();

    smallButton('Image').click();
    fixture.detectChanges();

    expect(element.querySelector('.modal--visible')).not.toBeNull();
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
      (button: HTMLButtonElement): boolean => button.querySelector('span')?.textContent?.trim() === label,
    )!;
  }
});
