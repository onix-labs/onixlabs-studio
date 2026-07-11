import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';

import { Monaco } from '@shared/angular/services/monaco/monaco';
import { DEFAULT_CHANGE_MARGIN_OPTIONS } from './change-margin-controller';
import { ChangeMargins } from './change-margins';
import { splitLines } from './line-diff';

/**
 * Drives a stubbed Monaco editor and exposes the hooks the tests need to inspect what an attached
 * controller wrote and whether its listeners were torn down.
 */
interface EditorHarness {
  readonly monaco: typeof MonacoApi;
  readonly editor: MonacoApi.editor.IStandaloneCodeEditor;
  decorations(): MonacoApi.editor.IModelDeltaDecoration[];
  clears(): number;
  listenersDisposed(): boolean;
}

/**
 * Builds a stubbed editor and Monaco namespace seeded with the given content.
 * @param content The buffer content the stubbed model reports.
 * @returns Returns the harness.
 */
function createHarness(content: string): EditorHarness {
  let written: MonacoApi.editor.IModelDeltaDecoration[] = [];
  let clearCount: number = 0;
  let contentDisposed: boolean = false;
  let modelDisposed: boolean = false;

  const model: MonacoApi.editor.ITextModel = {
    getValue: (): string => content,
    getLineCount: (): number => splitLines(content).length,
  } as unknown as MonacoApi.editor.ITextModel;

  const collection: MonacoApi.editor.IEditorDecorationsCollection = {
    set: (decorations: MonacoApi.editor.IModelDeltaDecoration[]): void => {
      written = decorations;
    },
    clear: (): void => {
      written = [];
      clearCount += 1;
    },
  } as unknown as MonacoApi.editor.IEditorDecorationsCollection;

  const editor: MonacoApi.editor.IStandaloneCodeEditor = {
    createDecorationsCollection: (): MonacoApi.editor.IEditorDecorationsCollection => collection,
    onDidChangeModelContent: (): MonacoApi.IDisposable => ({
      dispose: (): void => {
        contentDisposed = true;
      },
    }),
    onDidChangeModel: (): MonacoApi.IDisposable => ({
      dispose: (): void => {
        modelDisposed = true;
      },
    }),
    getModel: (): MonacoApi.editor.ITextModel => model,
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
    editor: { OverviewRulerLane: { Left: 1 } },
  } as unknown as typeof MonacoApi;

  return {
    monaco,
    editor,
    decorations: (): MonacoApi.editor.IModelDeltaDecoration[] => written,
    clears: (): number => clearCount,
    listenersDisposed: (): boolean => contentDisposed && modelDisposed,
  };
}

/**
 * Configures the testing module with a Monaco service reporting the given namespace, and resolves
 * the {@link ChangeMargins} service.
 * @param namespace The Monaco namespace the stubbed service reports, or undefined when not loaded.
 * @returns Returns the resolved {@link ChangeMargins} instance.
 */
function setup(namespace: typeof MonacoApi | undefined): ChangeMargins {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Monaco,
        useValue: { getMonaco: (): typeof MonacoApi | undefined => namespace },
      },
    ],
  });
  return TestBed.inject(ChangeMargins);
}

describe('ChangeMargins', () => {
  afterEach((): void => {
    document.documentElement.style.removeProperty('--change-margin-unsaved');
    document.documentElement.style.removeProperty('--change-margin-saved');
  });

  it('attach_whenMonacoUnavailable_returnsNull', () => {
    const harness: EditorHarness = createHarness('a');
    const service: ChangeMargins = setup(undefined);

    expect(service.attach(harness.editor, 'a', true)).toBeNull();
    expect(harness.decorations()).toEqual([]);
  });

  it('attach_whenMonacoLoaded_returnsControllerDrawingTheChangeMargin', () => {
    const harness: EditorHarness = createHarness('a\nb');
    const service: ChangeMargins = setup(harness.monaco);

    expect(service.attach(harness.editor, 'a\nb', true)).not.toBeNull();

    const classes: (string | null | undefined)[] = harness
      .decorations()
      .map(
        (decoration: MonacoApi.editor.IModelDeltaDecoration): string | null | undefined =>
          decoration.options.linesDecorationsClassName,
      );
    expect(classes).toEqual(['change-margin--saved', 'change-margin--saved']);
  });

  it('attach_appliesTheResolvedThemeColoursToTheOverviewRuler', () => {
    const harness: EditorHarness = createHarness('a');
    const service: ChangeMargins = setup(harness.monaco);
    document.documentElement.style.setProperty('--change-margin-unsaved', '#123456');

    // A never-saved document marks every line unsaved, which carries the overview-ruler colour.
    service.attach(harness.editor, '', false);

    const ruler: { color: string } | undefined = harness.decorations()[0].options.overviewRuler as
      | { color: string }
      | undefined;
    expect(ruler?.color).toBe(service.resolveColors().unsaved);
  });

  it('resolveColors_whenPropertiesUnset_fallsBackToTheDefaults', () => {
    const service: ChangeMargins = setup(undefined);

    expect(service.resolveColors()).toEqual(DEFAULT_CHANGE_MARGIN_OPTIONS.colors);
  });

  it('detach_whenControllerAttached_disposesItExactlyOnce', () => {
    const harness: EditorHarness = createHarness('a');
    const service: ChangeMargins = setup(harness.monaco);
    const controller: NonNullable<ReturnType<ChangeMargins['attach']>> = service.attach(
      harness.editor,
      'a',
      true,
    )!;
    const clearsBefore: number = harness.clears();

    service.detach(controller);
    service.detach(controller);

    expect(harness.clears()).toBe(clearsBefore + 1);
    expect(harness.listenersDisposed()).toBe(true);
  });

  it('ngOnDestroy_disposesEveryAttachedController', () => {
    const first: EditorHarness = createHarness('a');
    const second: EditorHarness = createHarness('b');
    const service: ChangeMargins = setup(first.monaco);
    service.attach(first.editor, 'a', true);
    service.attach(second.editor, 'b', true);

    service.ngOnDestroy();

    expect(first.listenersDisposed()).toBe(true);
    expect(second.listenersDisposed()).toBe(true);
  });
});
