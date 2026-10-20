import { DebugElement, Injector } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type * as MonacoApi from 'monaco-editor';
import type { MockInstance } from 'vitest';
import { EditorContextMenuHost } from '@shared/angular/components/editor-context-menu/editor-context-menu-host';
import { EditorContextMenu } from '@shared/angular/services/editor-context-menu/editor-context-menu';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { HoverCards } from '@shared/angular/services/hover/hover-cards';
import { ColourPickers } from '@shared/angular/services/colour-picker/colour-pickers';
import { DiffEditor } from './diff-editor';

describe('DiffEditor', () => {
  let fixture: ComponentFixture<DiffEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiffEditor],
    }).compileComponents();

    fixture = TestBed.createComponent(DiffEditor);
    fixture.componentRef.setInput('original', 'before');
    fixture.componentRef.setInput('modified', 'after');
    fixture.componentRef.setInput('language', 'plaintext');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_mountsTheMonacoHostElement', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.diff-editor')).not.toBeNull();
  });

  it('api_beforeTheEditorIsCreated_reportsNoInstance', () => {
    // Monaco does not load under the test runner, so the engine is never created; the imperative API
    // stays null-safe.
    expect(fixture.componentInstance.getDiffEditor()).toBeNull();
  });
});

describe('DiffEditor over a stand-in Monaco diff editor (#1012)', () => {
  it('attachesBothSidesToTheRightClickMenu_withTheHostInItsOwnView_andDetachesOnDestroy', async () => {
    const side: () => MonacoApi.editor.ICodeEditor = (): MonacoApi.editor.ICodeEditor =>
      ({
        onDidChangeCursorPosition: (): MonacoApi.IDisposable => ({
          dispose: (): void => undefined,
        }),
        getPosition: (): null => null,
      }) as unknown as MonacoApi.editor.ICodeEditor;
    const original: MonacoApi.editor.ICodeEditor = side();
    const modified: MonacoApi.editor.ICodeEditor = side();
    const diff: unknown = {
      onDidUpdateDiff: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      getOriginalEditor: (): MonacoApi.editor.ICodeEditor => original,
      getModifiedEditor: (): MonacoApi.editor.ICodeEditor => modified,
      setModel: (): void => undefined,
      updateOptions: (): void => undefined,
      dispose: (): void => undefined,
    };
    await TestBed.configureTestingModule({ imports: [DiffEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        createDiffEditor: (): unknown => diff,
        createModel: (): unknown => ({ dispose: (): void => undefined }),
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<EditorContextMenu['attach']> = vi
      .spyOn(TestBed.inject(EditorContextMenu), 'attach')
      .mockReturnValue((): void => void (detached += 1));
    let cardsDetached: number = 0;
    const attachCards: MockInstance<HoverCards['attach']> = vi
      .spyOn(TestBed.inject(HoverCards), 'attach')
      .mockReturnValue((): void => void (cardsDetached += 1));
    let pickersDetached: number = 0;
    const attachPickers: MockInstance<ColourPickers['attach']> = vi
      .spyOn(TestBed.inject(ColourPickers), 'attach')
      .mockReturnValue((): void => void (pickersDetached += 1));

    const fixture: ComponentFixture<DiffEditor> = TestBed.createComponent(DiffEditor);
    await fixture.whenStable();

    const host: DebugElement = fixture.debugElement.query(By.directive(EditorContextMenuHost));
    expect(attach.mock.calls).toEqual([
      [original, host.componentInstance],
      [modified, host.componentInstance],
    ]);
    // #1020: both sides show Studio's hover card, drawn in this pane's window.
    expect(attachCards.mock.calls.map((call: [unknown, Injector]): unknown => call[0])).toEqual([
      original,
      modified,
    ]);
    for (const [, injector] of attachCards.mock.calls) {
      expect(injector.get(DiffEditor)).toBe(fixture.componentInstance);
    }
    // #1025: a swatch on either side opens Studio's colour picker, drawn in this pane's window.
    expect(attachPickers.mock.calls.map((call: [unknown, Injector]): unknown => call[0])).toEqual([
      original,
      modified,
    ]);
    expect(attachPickers.mock.calls[0][1].get(DiffEditor)).toBe(fixture.componentInstance);
    fixture.destroy();
    expect(detached).toBe(2);
    expect(cardsDetached).toBe(2);
    expect(pickersDetached).toBe(2);
  });
});
