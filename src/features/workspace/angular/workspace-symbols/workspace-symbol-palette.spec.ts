import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { LspClient, WorkspaceSymbolMatch } from '@shared/angular/services/lsp/lsp-client';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { WorkspaceSymbolPalette } from './workspace-symbol-palette';

/**
 * The symbol the fake servers find.
 */
const FORMAL_GREETER: WorkspaceSymbolMatch = {
  name: 'FormalGreeter',
  kind: 5,
  container: 'project Fixture.Services (net10.0)',
  path: '/root/Services/FormalGreeter.cs',
  range: { startLineNumber: 5, startColumn: 21, endLineNumber: 5, endColumn: 34 },
};

describe('WorkspaceSymbolPalette (#1146)', () => {
  let search: Mock<(query: string) => Promise<readonly WorkspaceSymbolMatch[]>>;
  let goTo: Mock<EditorNavigation['goTo']>;

  /**
   * Builds the palette over fake servers and navigation.
   * @returns Returns the palette.
   */
  function build(): WorkspaceSymbolPalette {
    TestBed.configureTestingModule({
      providers: [
        WorkspaceSymbolPalette,
        { provide: LspClient, useValue: { workspaceSymbols: search } },
        { provide: EditorNavigation, useValue: { goTo } },
      ],
    });
    return TestBed.inject(WorkspaceSymbolPalette);
  }

  /**
   * Renders what changed.
   */
  function render(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  /**
   * Gets the box's field.
   * @returns Returns the input, or null when the box is closed.
   */
  function field(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('app-quick-open app-text-field input');
  }

  /**
   * Types into the box.
   * @param text What to type.
   */
  function type(text: string): void {
    field()!.value = text;
    field()!.dispatchEvent(new Event('input'));
    render();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    search = vi.fn<(query: string) => Promise<readonly WorkspaceSymbolMatch[]>>(
      (): Promise<readonly WorkspaceSymbolMatch[]> => Promise.resolve([FORMAL_GREETER]),
    );
    goTo = vi.fn<EditorNavigation['goTo']>((): Promise<void> => Promise.resolve());
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((node: Element) => node.remove());
  });

  it('searchesOnceTypingPauses_andListsWhatTheServersFound', async () => {
    build().open();
    render();

    type('F');
    type('Fo');
    type('FoGr');
    await vi.advanceTimersByTimeAsync(150);
    render();

    expect(search.mock.calls).toEqual([['FoGr']]);
    expect(document.querySelector('app-quick-open .quick-open__name')?.textContent).toBe(
      'FormalGreeter',
    );
    expect(document.querySelector('app-quick-open .quick-open__container')?.textContent).toBe(
      'project Fixture.Services (net10.0)',
    );
  });

  it('enter_closesTheBox_andOpensTheSymbolsFileAtItsName', async () => {
    build().open();
    render();
    type('FoGr');
    await vi.advanceTimersByTimeAsync(150);
    render();

    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    render();

    expect(goTo).toHaveBeenCalledWith(
      null,
      {
        path: '/root/Services/FormalGreeter.cs',
        range: { startLineNumber: 5, startColumn: 21, endLineNumber: 5, endColumn: 34 },
      },
      true,
    );
    expect(field()).toBeNull();
  });

  it('anOlderSearchsLateAnswer_isDropped', async () => {
    let answerFirst: (matches: readonly WorkspaceSymbolMatch[]) => void = (): void => undefined;
    search
      .mockImplementationOnce(
        (): Promise<readonly WorkspaceSymbolMatch[]> =>
          new Promise<readonly WorkspaceSymbolMatch[]>((resolve) => {
            answerFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([]);
    build().open();
    render();
    type('Old');
    await vi.advanceTimersByTimeAsync(150);
    type('New');
    await vi.advanceTimersByTimeAsync(150);

    answerFirst([FORMAL_GREETER]);
    await vi.advanceTimersByTimeAsync(0);
    render();

    expect(document.querySelector('app-quick-open .quick-open__name')).toBeNull();
    expect(document.querySelector('app-quick-open')?.textContent).toContain(
      'No symbols match “New”',
    );
  });

  it('escape_closesTheBox_andGoesNowhere', () => {
    const palette: WorkspaceSymbolPalette = build();
    palette.open();
    palette.open();
    render();
    expect(document.querySelectorAll('app-quick-open')).toHaveLength(1);

    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    render();

    expect(field()).toBeNull();
    expect(goTo).not.toHaveBeenCalled();
  });
});
