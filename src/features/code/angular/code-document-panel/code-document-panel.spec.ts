import { Component, forwardRef, input, InputSignal, output, OutputEmitterRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CodeDocumentEditor } from '@features/code/angular/code-document/code-document';
import { TextEditorCursor } from '@shared/angular/components/text-editor/text-editor';
import { Documents } from '@shared/angular/services/documents/documents';
import { Editors } from '@shared/angular/services/editors/editors';
import { LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { Settings } from '@shared/angular/services/settings/settings';
import { CodeSymbol, SymbolKind } from '@shared/angular/services/lsp/lsp-symbols';

import { CodeDocumentPanel } from './code-document-panel';

/**
 * Where the stand-in editor was last sent, and whether it was given focus.
 */
interface Moves {
  position: { lineNumber: number; column: number } | null;
  focused: boolean;
  actions: string[];
}

/**
 * The editor's stand-in. Monaco cannot boot under jsdom, so this takes the real editor's place: it
 * reports a cursor and records where the panel sends it.
 */
@Component({
  selector: 'app-code-document',
  template: '',
  providers: [{ provide: CodeDocumentEditor, useExisting: forwardRef(() => StandInEditor) }],
})
class StandInEditor {
  public static readonly moves: Moves = { position: null, focused: false, actions: [] };
  public readonly documentId: InputSignal<string> = input.required<string>();
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(true);
  public readonly ready: OutputEmitterRef<void> = output<void>();
  public readonly cursorChange: OutputEmitterRef<TextEditorCursor> = output<TextEditorCursor>();
  public readonly eolChange: OutputEmitterRef<string> = output<string>();
  public readonly selectionChange: OutputEmitterRef<boolean> = output<boolean>();

  /**
   * Gets a pane whose editor records where it is sent.
   * @returns Returns the pane.
   */
  public getPane(): unknown {
    return {
      getEditor: (): unknown => ({
        getModel: (): unknown => ({ uri: { toString: (): string => 'inmemory://model/1' } }),
        setPosition: (position: { lineNumber: number; column: number }): void => {
          StandInEditor.moves.position = position;
        },
        revealPositionInCenterIfOutsideViewport: (): void => undefined,
        focus: (): void => {
          StandInEditor.moves.focused = true;
        },
        getAction: (id: string): unknown => ({
          run: (): Promise<void> => {
            StandInEditor.moves.actions.push(id);
            return Promise.resolve();
          },
        }),
      }),
      getModelUri: (): string => 'inmemory://model/1',
      reveal: (line: number, column: number): void => {
        StandInEditor.moves.position = { lineNumber: line, column };
      },
    };
  }
}

/**
 * Builds a symbol over whole lines.
 * @param name The name.
 * @param kind The kind.
 * @param from The first line, zero-based.
 * @param to The last line, zero-based.
 * @param children The symbols inside it.
 * @returns Returns the symbol.
 */
function symbol(
  name: string,
  kind: number,
  from: number,
  to: number,
  children: readonly CodeSymbol[] = [],
): CodeSymbol {
  const range: CodeSymbol['range'] = {
    start: { line: from, character: 0 },
    end: { line: to, character: 80 },
  };
  return {
    name,
    kind,
    range,
    selectionRange: { start: { line: from, character: 6 }, end: { line: from, character: 12 } },
    children,
  };
}

describe('CodeDocumentPanel', () => {
  let symbols: readonly CodeSymbol[] | null;

  beforeEach(async () => {
    symbols = null;
    StandInEditor.moves.position = null;
    StandInEditor.moves.focused = false;
    StandInEditor.moves.actions = [];
    await TestBed.configureTestingModule({
      imports: [CodeDocumentPanel],
      providers: [
        {
          provide: LspFeatures,
          useValue: {
            documentSymbols: (): Promise<unknown> => Promise.resolve(symbols),
            servesDocument: (): boolean => symbols !== null,
          },
        },
      ],
    })
      .overrideComponent(CodeDocumentPanel, {
        remove: { imports: [CodeDocumentEditor] },
        add: { imports: [StandInEditor] },
      })
      .compileComponents();
  });

  /**
   * Builds the panel, lets its editor report ready, and waits for the symbols to be read.
   * @returns Returns the fixture.
   */
  async function built(): Promise<ComponentFixture<CodeDocumentPanel>> {
    vi.useFakeTimers();
    TestBed.inject(Documents).ensure('test-document', 'greeter.ts');
    const fixture: ComponentFixture<CodeDocumentPanel> = TestBed.createComponent(CodeDocumentPanel);
    fixture.componentRef.setInput('documentId', 'test-document');
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { onReady(): void }).onReady();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(600);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Moves the cursor, as the editor reports it.
   * @param fixture The fixture.
   * @param line The one-based line.
   */
  function cursorAt(fixture: ComponentFixture<CodeDocumentPanel>, line: number): void {
    (
      fixture.componentInstance as unknown as { onCursorChange(cursor: TextEditorCursor): void }
    ).onCursorChange({ line, column: 5 });
    fixture.detectChanges();
  }

  /**
   * Gets one of the strip's selects.
   * @param fixture The fixture.
   * @param label The select's accessible name.
   * @returns Returns the select, or null when it is not drawn.
   */
  function select(
    fixture: ComponentFixture<CodeDocumentPanel>,
    label: string,
  ): HTMLSelectElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      `.document-panel__strip select[aria-label="${label}"]`,
    );
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drawsTheStrip_withTheDropdownsDisabled_whenNoLanguageServerAnswers', async () => {
    // Matthew, #882: a code file never shows without a tool strip.
    const fixture: ComponentFixture<CodeDocumentPanel> = await built();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.document-panel__strip'),
    ).not.toBeNull();
    expect(select(fixture, 'Type')?.disabled).toBe(true);
    expect(select(fixture, 'Member')?.disabled).toBe(true);
  });

  it('aRevealAimedAtThisDocument_movesItsCaret_asTheCodeTabDoes', async () => {
    // #882: Find & Replace's results and a diff's Open File ask for it; a well editor used to ignore it.
    await built();

    TestBed.inject(Editors).requestReveal('test-document', 12, 3);
    TestBed.tick();

    expect(StandInEditor.moves.position).toEqual({ lineNumber: 12, column: 3 });
  });

  it('theStripsButtons_runTheEditorsOwnFoldAndFind', async () => {
    const fixture: ComponentFixture<CodeDocumentPanel> = await built();
    const press: (label: string) => void = (label: string): void =>
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>(`.document-panel__strip button[aria-label="${label}"]`)
        ?.click();

    press('Fold All');
    press('Unfold All');
    press('Find');

    expect(StandInEditor.moves.actions).toEqual([
      'editor.foldAll',
      'editor.unfoldAll',
      'actions.find',
    ]);
  });

  it('theMenusViewOptions_areTheEditorWideSettings_theRibbonsCheckboxesSet', async () => {
    // #882: Word Wrap moved off the strip into the menu, beside the ribbon's other two checkboxes.
    const fixture: ComponentFixture<CodeDocumentPanel> = await built();
    const settings: Settings = TestBed.inject(Settings);
    const panel: {
      onMenu(id: string): void;
      menuItems(): { label: string; checked?: boolean }[];
    } = fixture.componentInstance as unknown as {
      onMenu(id: string): void;
      menuItems(): { label: string; checked?: boolean }[];
    };
    const checked: (label: string) => boolean | undefined = (label: string): boolean | undefined =>
      panel.menuItems().find((item: { label: string }): boolean => item.label === label)?.checked;
    const before: { wordWrap: boolean; showMinimap: boolean; showLineNumbers: boolean } = {
      ...settings.globalTextEditor(),
    };

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '.document-panel__strip button[aria-label="Word Wrap"]',
      ),
    ).toBeNull();
    expect(checked('Word Wrap')).toBe(before.wordWrap);

    panel.onMenu('code.wordWrap');
    panel.onMenu('code.minimap');
    panel.onMenu('code.lineNumbers');

    expect(settings.globalTextEditor().wordWrap).toBe(!before.wordWrap);
    expect(settings.globalTextEditor().showMinimap).toBe(!before.showMinimap);
    expect(settings.globalTextEditor().showLineNumbers).toBe(!before.showLineNumbers);
    expect(checked('Minimap')).toBe(!before.showMinimap);
  });

  it('theMenu_offersTheFilesOwnCommands_onlyOnceItHasAPath', async () => {
    const fixture: ComponentFixture<CodeDocumentPanel> = await built();
    const items: { label: string; disabled?: boolean }[] = (
      fixture.componentInstance as unknown as {
        menuItems(): { label: string; disabled?: boolean }[];
      }
    ).menuItems();
    const disabled: (label: string) => boolean | undefined = (label: string): boolean | undefined =>
      items.find((item: { label: string }): boolean => item.label === label)?.disabled;

    expect(items.map((item: { label: string }): string => item.label)).toEqual([
      'Go to Symbol…',
      'Go to Line…',
      '',
      'Word Wrap',
      'Minimap',
      'Line Numbers',
      '',
      'Copy Path',
      'Select in File Explorer',
      'Open in File System',
    ]);
    // The test document is untitled: nothing on disk to copy, select or open.
    expect(disabled('Copy Path')).toBe(true);
    expect(disabled('Open in File System')).toBe(true);
  });

  it('theDropdowns_followTheCursor_throughTheTypeAndItsMembers', async () => {
    symbols = [
      symbol('Greeter', SymbolKind.Class, 0, 10, [
        symbol('name', SymbolKind.Field, 1, 1),
        symbol('greet', SymbolKind.Method, 3, 6),
      ]),
    ];
    const fixture: ComponentFixture<CodeDocumentPanel> = await built();

    cursorAt(fixture, 5);

    const types: HTMLSelectElement | null = select(fixture, 'Type');
    const members: HTMLSelectElement | null = select(fixture, 'Member');
    expect(types?.selectedOptions[0]?.textContent?.trim()).toBe('Greeter');
    expect(
      Array.from(members?.options ?? []).map((option) => option.textContent?.trim()),
    ).toContain('greet');
    expect(members?.selectedOptions[0]?.textContent?.trim()).toBe('greet');
  });

  it('choosingAMember_putsTheCursorOnItsName_andFocusesTheEditor', async () => {
    symbols = [
      symbol('Greeter', SymbolKind.Class, 0, 10, [
        symbol('name', SymbolKind.Field, 1, 1),
        symbol('greet', SymbolKind.Method, 3, 6),
      ]),
    ];
    const fixture: ComponentFixture<CodeDocumentPanel> = await built();
    cursorAt(fixture, 2);
    const panel: { goToMember(id: string): void; memberOptions(): { value: string }[] } =
      fixture.componentInstance as unknown as {
        goToMember(id: string): void;
        memberOptions(): { value: string }[];
      };

    panel.goToMember(panel.memberOptions()[1].value);

    // `greet` is declared on line 3 (zero-based), its name from character 6: one-based, 4 and 7.
    expect(StandInEditor.moves.position).toEqual({ lineNumber: 4, column: 7 });
    expect(StandInEditor.moves.focused).toBe(true);
  });
});
