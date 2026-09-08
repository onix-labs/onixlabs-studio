import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '@milkdown/ctx';
import type { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownToolstrip } from './markdown-toolstrip';

/**
 * Builds a fake markdown-editor pane whose `run` records each action it is handed.
 * @returns Returns the fake pane and its recorded calls.
 */
function fakePane(): { pane: MarkdownEditor; runs: ((ctx: Ctx) => unknown)[] } {
  const runs: ((ctx: Ctx) => unknown)[] = [];
  const pane: MarkdownEditor = {
    run: (action: (ctx: Ctx) => unknown): void => {
      runs.push(action);
    },
  } as unknown as MarkdownEditor;
  return { pane, runs };
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
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((button: HTMLButtonElement): string | null => button.getAttribute('aria-label'));
    expect(labels).toEqual(FORMATTING_LABELS);
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

  it('openInTabButton_isAbsentByDefault', () => {
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Open in Tab"]'),
    ).toBeNull();
  });

  it('openInTabButton_whenEnabled_emitsTheIntent', () => {
    const fixture: ComponentFixture<MarkdownToolstrip> = createStrip(undefined, true);
    let emitted: number = 0;
    fixture.componentInstance.openInTab.subscribe((): void => {
      emitted++;
    });
    buttonNamed(fixture, 'Open in Tab').click();
    expect(emitted).toBe(1);
  });
});
