import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@milkdown/ctx';
import type { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Icon } from '@shared/angular/icons/icon';
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

/**
 * The strip's clipboard buttons, by accessible name, in display order. Kept apart from the formatting
 * buttons because they do not each hand the pane one action: Cut and Copy run the browser's own
 * clipboard command against the focused pane, and Paste reads the clipboard before it acts.
 */
const CLIPBOARD_LABELS: readonly string[] = ['Cut', 'Copy', 'Paste'];

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
    expect(labels).toEqual([
      ...FORMATTING_LABELS.slice(0, 2),
      ...CLIPBOARD_LABELS,
      ...FORMATTING_LABELS.slice(2),
      'More Actions',
    ]);
  });

  it('documentSwitch_whenGiven_sitsBeforeTheMenu_andRunsWhenPressed', () => {
    const run: () => Promise<boolean> = vi.fn((): Promise<boolean> => Promise.resolve(true));
    const fixture: ComponentFixture<MarkdownToolstrip> = TestBed.createComponent(MarkdownToolstrip);
    fixture.componentRef.setInput('documentSwitch', {
      label: 'Show Differences',
      icon: Icon.GIT_DIFF,
      unavailable: null,
      run,
    });
    fixture.detectChanges();

    const labels: (string | null)[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-button button'),
    ).map((button: Element): string | null => button.getAttribute('aria-label'));
    expect(labels.slice(-2)).toEqual(['Show Differences', 'More Actions']);
    buttonNamed(fixture, 'Show Differences').click();
    expect(run).toHaveBeenCalledOnce();
  });

  it('documentSwitch_whenUnavailable_isDisabled', () => {
    const fixture: ComponentFixture<MarkdownToolstrip> = TestBed.createComponent(MarkdownToolstrip);
    fixture.componentRef.setInput('documentSwitch', {
      label: 'Show Differences',
      icon: Icon.GIT_DIFF,
      unavailable: 'No changes against HEAD',
      run: (): Promise<boolean> => Promise.resolve(true),
    });
    fixture.detectChanges();

    expect(buttonNamed(fixture, 'Show Differences').hasAttribute('disabled')).toBe(true);
  });

  it('theFormatDropdown_sitsBetweenTheClipboardAndFormatting_listingTheMarkdownTabsBlockTypes', () => {
    // #882: the markdown tab's style field, on the well's strip too — after the history and clipboard
    // clusters, each set apart from the next by a divider.
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip();
    const order: string[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelector('.markdown-toolstrip')?.children ?? [],
    )
      .slice(0, 10)
      .map((element: Element): string =>
        element.tagName === 'APP-DROPDOWN'
          ? 'format'
          : element.classList.contains('markdown-toolstrip__divider')
            ? '|'
            : (element.querySelector('button')?.getAttribute('aria-label') ?? '?'),
      );
    expect(order).toEqual([
      'Undo',
      'Redo',
      '|',
      'Cut',
      'Copy',
      'Paste',
      '|',
      'format',
      '|',
      'Bold',
    ]);
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
      for (const label of [...FORMATTING_LABELS, ...CLIPBOARD_LABELS]) {
        buttonNamed(fixture, label).click();
      }
    }).not.toThrow();
  });

  describe('the clipboard buttons', () => {
    let execCommand: (command: string) => boolean;
    let readText: () => Promise<string>;
    let originalClipboard: PropertyDescriptor | undefined;

    beforeEach(() => {
      // happy-dom implements neither execCommand nor a readable clipboard, so both are stood in for.
      execCommand = vi.fn((): boolean => true);
      (document as unknown as { execCommand: (command: string) => boolean }).execCommand =
        execCommand;
      readText = vi.fn((): Promise<string> => Promise.resolve('**pasted**'));
      originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText },
      });
    });

    afterEach(() => {
      if (originalClipboard !== undefined) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      }
    });

    it('cutAndCopy_focusThePane_thenRunTheNativeCommand', () => {
      // Focus first: pressing the button has just taken focus from the pane, and the native command
      // acts on whatever holds it.
      const { pane } = fakePane();
      const focusEditor: () => void = vi.fn();
      (pane as unknown as { focusEditor: () => void }).focusEditor = focusEditor;
      const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(pane);

      buttonNamed(fixture, 'Cut').click();
      buttonNamed(fixture, 'Copy').click();

      expect(focusEditor).toHaveBeenCalledTimes(2);
      expect(execCommand).toHaveBeenNthCalledWith(1, 'cut');
      expect(execCommand).toHaveBeenNthCalledWith(2, 'copy');
    });

    it('paste_readsTheClipboard_andRunsOneActionAgainstThePane', async () => {
      const { pane, runs } = fakePane();
      const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(pane);

      buttonNamed(fixture, 'Paste').click();
      await Promise.resolve();
      await Promise.resolve();

      expect(readText).toHaveBeenCalledTimes(1);
      expect(runs).toHaveLength(1);
    });

    it('paste_ofAnEmptyClipboard_leavesThePaneAlone', async () => {
      readText = vi.fn((): Promise<string> => Promise.resolve(''));
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText },
      });
      const { pane, runs } = fakePane();
      const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(pane);

      buttonNamed(fixture, 'Paste').click();
      await Promise.resolve();
      await Promise.resolve();

      expect(runs).toHaveLength(0);
    });
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
