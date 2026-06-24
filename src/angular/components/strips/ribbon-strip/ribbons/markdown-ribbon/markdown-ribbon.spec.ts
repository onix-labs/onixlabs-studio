import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  MarkdownCommandHandler,
  MarkdownCommands,
} from '../../../../../services/markdown-commands/markdown-commands';
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

  it('insertGroup_whenRendered_showsTheFourCategoryMenuButtons', () => {
    expect(menuPrimary('Lists')).not.toBeUndefined();
    expect(menuPrimary('Blocks')).not.toBeUndefined();
    expect(menuPrimary('Media')).not.toBeUndefined();
    expect(menuPrimary('Inline')).not.toBeUndefined();
  });

  it('blocksButton_whenPrimaryClicked_insertsATable', () => {
    const inserted: string[] = [];
    const commands: MarkdownCommands = TestBed.inject(MarkdownCommands);
    commands.register(recordingHandler(inserted));

    menuPrimary('Blocks').click();

    expect(inserted).toContain('table');
  });

  it('listsButton_whenPrimaryClicked_insertsABulletedList', () => {
    const inserted: string[] = [];
    const commands: MarkdownCommands = TestBed.inject(MarkdownCommands);
    commands.register(recordingHandler(inserted));

    menuPrimary('Lists').click();

    expect(inserted).toContain('bullet-list');
  });

  it('mediaButton_whenPrimaryClicked_opensTheImageModal', () => {
    expect(element.querySelector('.modal--visible')).toBeNull();

    menuPrimary('Media').click();
    fixture.detectChanges();

    expect(element.querySelector('.modal--visible')).not.toBeNull();
  });

  /**
   * Finds a menu button's primary action button by its label.
   * @param label The primary action's label text.
   * @returns Returns the matching button.
   */
  function menuPrimary(label: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.ribbon-menu-button__action'),
    );
    return buttons.find(
      (button: HTMLButtonElement): boolean => button.querySelector('span')?.textContent?.trim() === label,
    )!;
  }
});
