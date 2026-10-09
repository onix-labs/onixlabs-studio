import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '@milkdown/ctx';
import type { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownToolstrip } from './markdown-toolstrip';

/**
 * Builds a fake markdown-editor pane whose `run` records each action it is handed.
 * @returns Returns the fake pane and its recorded calls.
 */
function fakePane(): {
  pane: MarkdownEditor;
  runs: ((ctx: Ctx) => unknown)[];
  moveTo: (selection: unknown) => void;
} {
  const runs: ((ctx: Ctx) => unknown)[] = [];
  let listener: ((selection: unknown) => void) | null = null;
  const pane: MarkdownEditor = {
    run: (action: (ctx: Ctx) => unknown): void => {
      runs.push(action);
    },
    getEditorView: (): null => null,
    selectionChange: {
      subscribe: (next: (selection: unknown) => void): { unsubscribe(): void } => {
        listener = next;
        return { unsubscribe: (): void => undefined };
      },
    },
  } as unknown as MarkdownEditor;
  return { pane, runs, moveTo: (selection: unknown): void => listener?.(selection) };
}

/**
 * Builds a selection inside a block of the given type, as ProseMirror reports one.
 * @param name The block node's type name.
 * @param attrs The node's attributes.
 * @returns Returns the selection.
 */
function selectionIn(name: string, attrs: Record<string, unknown> = {}): unknown {
  const nodes: { type: { name: string }; attrs: Record<string, unknown> }[] = [
    { type: { name: 'doc' }, attrs: {} },
    { type: { name }, attrs },
  ];
  return { $from: { depth: 1, node: (depth: number): unknown => nodes[depth] } };
}

/**
 * The strip's formatting buttons, by accessible name, in display order.
 */
const FORMATTING_LABELS: readonly string[] = [
  'Undo',
  'Redo',
  'Bold',
  'Italic',
  'Strikethrough',
  'Inline code',
  'Bullet list',
  'Numbered list',
  'Task list',
  'Insert table',
  'Insert divider',
];

describe('MarkdownToolstrip', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownToolstrip],
    }).compileComponents();
  });

  /**
   * Creates the fixture, optionally binding a pane and the open-in-tab affordance.
   * @param pane The pane to bind, if any.
   * @param showOpenInTab Whether the open-in-tab button is enabled.
   * @returns Returns the fixture.
   */
  function createStrip(
    pane?: MarkdownEditor,
    showOpenInTab: boolean = false,
  ): ComponentFixture<MarkdownToolstrip> {
    const fixture: ComponentFixture<MarkdownToolstrip> = TestBed.createComponent(MarkdownToolstrip);
    if (pane !== undefined) {
      fixture.componentRef.setInput('editor', pane);
    }
    fixture.componentRef.setInput('showOpenInTab', showOpenInTab);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Finds a strip button by its accessible name.
   * @param fixture The strip fixture.
   * @param label The button's aria-label.
   * @returns Returns the button element.
   */
  function buttonNamed(fixture: ComponentFixture<MarkdownToolstrip>, label: string): HTMLElement {
    const button: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      `button[aria-label="${label}"]`,
    );
    expect(button, `button "${label}"`).not.toBeNull();
    return button!;
  }

  it('renders_everyFormattingControl_inOrder', () => {
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip();
    const labels: (string | null)[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-button button'),
    ).map((button: Element): string | null => button.getAttribute('aria-label'));
    // The menu ends the strip, as it ends every document strip.
    expect(labels).toEqual([...FORMATTING_LABELS, 'More Actions']);
  });

  it('theFormatDropdown_sitsBetweenHistoryAndFormatting_listingTheMarkdownTabsBlockTypes', () => {
    // #882: the markdown tab's style field, on the well's strip too — after Undo and Redo, set apart
    // from both them and the formatting buttons by a divider.
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip();
    const order: string[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelector('.markdown-toolstrip')?.children ?? [],
    )
      .slice(0, 6)
      .map((element: Element): string =>
        element.tagName === 'APP-DROPDOWN'
          ? 'format'
          : element.classList.contains('markdown-toolstrip__divider')
            ? '|'
            : (element.querySelector('button')?.getAttribute('aria-label') ?? '?'),
      );
    expect(order).toEqual(['Undo', 'Redo', '|', 'format', '|', 'Bold']);
    const format: HTMLSelectElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLSelectElement>('.markdown-toolstrip > app-dropdown select');

    expect(format?.getAttribute('aria-label')).toBe('Format');
    expect(Array.from(format?.options ?? []).map((option) => option.textContent?.trim())).toEqual([
      'Paragraph',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Heading 5',
      'Heading 6',
      'Blockquote',
      'Code Block',
      'Note',
      'Tip',
      'Important',
      'Warning',
      'Caution',
    ]);
  });

  it('theFormatDropdown_followsTheCursor_andTurnsTheBlockIntoTheChosenType', () => {
    const { pane, runs, moveTo } = fakePane();
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(pane);
    const strip: { blockType(): string; onBlockType(value: string): void } =
      fixture.componentInstance as unknown as {
        blockType(): string;
        onBlockType(value: string): void;
      };

    moveTo(selectionIn('heading', { level: 2 }));
    expect(strip.blockType()).toBe('heading-2');
    moveTo(selectionIn('blockquote'));
    expect(strip.blockType()).toBe('blockquote');

    strip.onBlockType('code-block');

    expect(runs).toHaveLength(1);
    expect(strip.blockType()).toBe('code-block');
  });

  it('everyFormattingButton_runsAnActionAgainstTheBoundPane', () => {
    const { pane, runs } = fakePane();
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(pane);
    for (const label of FORMATTING_LABELS) {
      buttonNamed(fixture, label).click();
    }
    expect(runs).toHaveLength(FORMATTING_LABELS.length);
  });

  it('clicks_withoutAPane_areSafeNoOps', () => {
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip();
    expect((): void => {
      for (const label of FORMATTING_LABELS) {
        buttonNamed(fixture, label).click();
      }
    }).not.toThrow();
  });

  it('paneActions_areDistinctPerButton', () => {
    // Each button must hand the pane its own command; two buttons sharing an action would be a
    // wiring slip this catches cheaply.
    const { pane, runs } = fakePane();
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(pane);
    buttonNamed(fixture, 'Bold').click();
    buttonNamed(fixture, 'Italic').click();
    expect(runs[0]).not.toBe(runs[1]);
  });

  /**
   * Reads the strip menu's item labels.
   * @param fixture The strip fixture.
   * @returns Returns the labels, a separator reading as empty.
   */
  function menuLabels(fixture: ComponentFixture<MarkdownToolstrip>): string[] {
    return (fixture.componentInstance as unknown as { menuItems(): { label: string }[] })
      .menuItems()
      .map((item: { label: string }): string => item.label);
  }

  it('theMenu_holdsTheFilesCommands_withNoOpenInTabButtonOnTheStrip', () => {
    // #882: Open in Tab moved from the strip into the menu every document strip ends with.
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Open in Tab"]'),
    ).toBeNull();
    expect(menuLabels(fixture)).toEqual([
      'Copy Path',
      'Select in File Explorer',
      'Open in File System',
    ]);
  });

  it('theMenu_offersOpenInTabFirst_whenTheHostCanOpenOne_andChoosingItEmitsTheIntent', () => {
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(undefined, true);
    let emitted: number = 0;
    fixture.componentInstance.openInTab.subscribe((): void => {
      emitted++;
    });

    expect(menuLabels(fixture)).toEqual([
      'Open in Tab',
      '',
      'Copy Path',
      'Select in File Explorer',
      'Open in File System',
    ]);
    (fixture.componentInstance as unknown as { onMenu(id: string): void }).onMenu(
      'markdown.openInTab',
    );

    expect(emitted).toBe(1);
  });
});
