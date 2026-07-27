import type * as MonacoApi from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { Breakpoint } from '@shared/angular/services/debug/breakpoints';
import { BreakpointGutterController } from './breakpoint-gutter-controller';

/**
 * The glyph-margin mouse-target type constant used by the stub.
 */
const GUTTER_GLYPH_MARGIN: number = 2;

/**
 * Captures a glyph decoration's class and the line it sits on.
 */
interface CapturedGlyph {
  readonly className: string | null | undefined;
  readonly line: number;
}

/**
 * Drives a stubbed Monaco editor and exposes the hooks the tests need: firing a glyph-margin click and
 * inspecting the glyphs the controller drew.
 */
interface EditorHarness {
  readonly monaco: typeof MonacoApi;
  readonly editor: MonacoApi.editor.IStandaloneCodeEditor;
  click(
    line: number | undefined,
    options?: { right?: boolean; alt?: boolean; type?: number },
  ): void;
  glyphs(): CapturedGlyph[];
}

/**
 * Builds a stubbed editor and Monaco namespace capturing decorations and the mouse listener.
 * @returns Returns the harness.
 */
function createHarness(): EditorHarness {
  let written: MonacoApi.editor.IModelDeltaDecoration[] = [];
  let mouseListener: ((event: MonacoApi.editor.IEditorMouseEvent) => void) | null = null;

  const collection: MonacoApi.editor.IEditorDecorationsCollection = {
    set: (decorations: MonacoApi.editor.IModelDeltaDecoration[]): void => {
      written = decorations;
    },
    clear: (): void => {
      written = [];
    },
  } as unknown as MonacoApi.editor.IEditorDecorationsCollection;

  const editor: MonacoApi.editor.IStandaloneCodeEditor = {
    createDecorationsCollection: (): MonacoApi.editor.IEditorDecorationsCollection => collection,
    onMouseDown: (
      listener: (event: MonacoApi.editor.IEditorMouseEvent) => void,
    ): MonacoApi.IDisposable => {
      mouseListener = listener;
      return { dispose: (): void => undefined };
    },
  } as unknown as MonacoApi.editor.IStandaloneCodeEditor;

  class Range {
    public constructor(
      public readonly startLineNumber: number,
      public readonly startColumn: number,
      public readonly endLineNumber: number,
      public readonly endColumn: number,
    ) {}
  }

  const monaco: typeof MonacoApi = {
    Range,
    editor: {
      MouseTargetType: { GUTTER_GLYPH_MARGIN },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 0 },
    },
  } as unknown as typeof MonacoApi;

  return {
    monaco,
    editor,
    click: (line: number | undefined, options = {}): void => {
      mouseListener?.({
        target: {
          type: options.type ?? GUTTER_GLYPH_MARGIN,
          position: line === undefined ? null : { lineNumber: line, column: 1 },
        },
        event: { rightButton: options.right ?? false, altKey: options.alt ?? false },
      } as unknown as MonacoApi.editor.IEditorMouseEvent);
    },
    glyphs: (): CapturedGlyph[] =>
      written.map(
        (decoration: MonacoApi.editor.IModelDeltaDecoration): CapturedGlyph => ({
          className: decoration.options.glyphMarginClassName,
          line: (decoration.range as unknown as { startLineNumber: number }).startLineNumber,
        }),
      ),
  };
}

/**
 * Builds a breakpoint.
 * @param overrides Fields to override on the base breakpoint.
 * @returns Returns the breakpoint.
 */
function breakpoint(overrides: Partial<Breakpoint> & { line: number }): Breakpoint {
  return { enabled: true, verified: false, ...overrides };
}

describe('BreakpointGutterController', () => {
  it('renders a glyph per breakpoint on its line', () => {
    const harness: EditorHarness = createHarness();
    const controller: BreakpointGutterController = new BreakpointGutterController(
      harness.monaco,
      harness.editor,
      () => undefined,
      () => undefined,
    );
    controller.render([breakpoint({ line: 3 }), breakpoint({ line: 7 })]);
    expect(harness.glyphs().map((g) => g.line)).toEqual([3, 7]);
  });

  it('marks conditional, logpoint, disabled, and verified breakpoints with distinct classes', () => {
    const harness: EditorHarness = createHarness();
    const controller: BreakpointGutterController = new BreakpointGutterController(
      harness.monaco,
      harness.editor,
      () => undefined,
      () => undefined,
    );
    controller.render([
      breakpoint({ line: 1, condition: 'x > 1' }),
      breakpoint({ line: 2, logMessage: 'log' }),
      breakpoint({ line: 3, enabled: false }),
      breakpoint({ line: 4, verified: true }),
    ]);
    const byLine: Map<number, string | null | undefined> = new Map<
      number,
      string | null | undefined
    >(harness.glyphs().map((g): [number, string | null | undefined] => [g.line, g.className]));
    expect(byLine.get(1)).toContain('breakpoint-glyph--conditional');
    expect(byLine.get(2)).toContain('breakpoint-glyph--logpoint');
    expect(byLine.get(3)).toContain('breakpoint-glyph--disabled');
    expect(byLine.get(4)).toContain('breakpoint-glyph--verified');
  });

  it('left-clicking the glyph margin toggles the line', () => {
    const harness: EditorHarness = createHarness();
    const toggled: number[] = [];
    const controller: BreakpointGutterController = new BreakpointGutterController(
      harness.monaco,
      harness.editor,
      (line) => toggled.push(line),
      () => undefined,
    );
    controller.render([]);
    harness.click(12);
    expect(toggled).toEqual([12]);
  });

  it('right-clicking edits instead of toggling', () => {
    const harness: EditorHarness = createHarness();
    const toggled: number[] = [];
    const edited: number[] = [];
    const controller: BreakpointGutterController = new BreakpointGutterController(
      harness.monaco,
      harness.editor,
      (line) => toggled.push(line),
      (line) => edited.push(line),
    );
    controller.render([]);
    harness.click(4, { right: true });
    expect(edited).toEqual([4]);
    expect(toggled).toEqual([]);
  });

  it('alt-clicking an existing breakpoint edits it', () => {
    const harness: EditorHarness = createHarness();
    const edited: number[] = [];
    const controller: BreakpointGutterController = new BreakpointGutterController(
      harness.monaco,
      harness.editor,
      () => undefined,
      (line) => edited.push(line),
    );
    controller.render([breakpoint({ line: 6 })]);
    harness.click(6, { alt: true });
    expect(edited).toEqual([6]);
  });

  it('ignores clicks outside the glyph margin', () => {
    const harness: EditorHarness = createHarness();
    const toggled: number[] = [];
    const controller: BreakpointGutterController = new BreakpointGutterController(
      harness.monaco,
      harness.editor,
      (line) => toggled.push(line),
      () => undefined,
    );
    controller.render([]);
    harness.click(5, { type: 6 });
    expect(toggled).toEqual([]);
  });
});
