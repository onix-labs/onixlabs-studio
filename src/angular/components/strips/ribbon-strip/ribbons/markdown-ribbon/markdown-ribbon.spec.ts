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
    toggleBulletList: noop,
    toggleOrderedList: noop,
    insertTable: noop,
    insertHorizontalRule: noop,
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

  it('insertGroup_whenRendered_showsNineIconButtons', () => {
    expect(element.querySelectorAll('.insert-grid .insert-button').length).toBe(9);
  });

  it('insertButtons_whenClicked_routeTableDividerAndDiagram', () => {
    const inserted: string[] = [];
    const commands: MarkdownCommands = TestBed.inject(MarkdownCommands);
    commands.register(recordingHandler(inserted));

    element.querySelector<HTMLButtonElement>('.insert-button[aria-label="Diagram"]')!.click();

    expect(inserted.some((entry: string): boolean => entry.startsWith('block:```mermaid'))).toBe(
      true,
    );
  });

  it('imageButton_whenClicked_opensTheImageModal', () => {
    expect(element.querySelector('.modal--visible')).toBeNull();

    element.querySelector<HTMLButtonElement>('.insert-button[aria-label="Image"]')!.click();
    fixture.detectChanges();

    expect(element.querySelector('.modal--visible')).not.toBeNull();
  });
});
