import type * as MonacoApi from 'monaco-editor';
import {
  FoldingPlaceholderController,
  foldPlaceholderClass,
} from './folding-placeholder-controller';

describe('foldPlaceholderClass', () => {
  it('choosesTheKAndRClassWhenTheLineEndsWithAnOpeningBrace', () => {
    expect(foldPlaceholderClass('    static void Main() {')).toBe('fold-placeholder--knr');
  });

  it('ignoresTrailingWhitespaceWhenDetectingAKAndRBrace', () => {
    expect(foldPlaceholderClass('void f() {   ')).toBe('fold-placeholder--knr');
  });

  it('choosesTheAllmanClassForACodeSignatureLine', () => {
    expect(foldPlaceholderClass('internal static class Program')).toBe('fold-placeholder--allman');
  });

  it('choosesTheRegionClassForARegionMarker', () => {
    expect(foldPlaceholderClass('#region Helpers')).toBe('fold-placeholder--region');
  });

  it('choosesTheRegionClassForALineCommentRegionMarker', () => {
    expect(foldPlaceholderClass('//region Helpers')).toBe('fold-placeholder--region');
  });

  it('choosesTheRegionClassForALineComment', () => {
    expect(foldPlaceholderClass('// a leading comment')).toBe('fold-placeholder--region');
  });

  it('choosesTheRegionClassForABlockComment', () => {
    expect(foldPlaceholderClass('/* a block comment')).toBe('fold-placeholder--region');
  });
});

describe('FoldingPlaceholderController', () => {
  /**
   * A one-event source, as a Monaco editor's are.
   */
  type Listener = (event?: unknown) => void;

  /**
   * The controller's editor, whose folds and model a spec moves.
   */
  class StandInEditor {
    public modelPresent: boolean = true;
    public folded: readonly number[] = [];
    public written: unknown[] = [];
    public cleared: number = 0;
    public unfolded: number = 0;
    public position: unknown = null;
    public listening: number = 0;
    private readonly listeners: Map<string, Listener> = new Map<string, Listener>();

    /**
     * Fires one of the editor's events.
     * @param name The event.
     * @param event The payload.
     */
    public fire(name: string, event?: unknown): void {
      this.listeners.get(name)?.(event);
    }

    /**
     * Builds the Monaco-shaped editor around this state.
     * @returns Returns the editor.
     */
    public editor(): MonacoApi.editor.IStandaloneCodeEditor {
      const listen: (name: string) => (listener: Listener) => MonacoApi.IDisposable =
        (name: string) =>
        (listener: Listener): MonacoApi.IDisposable => {
          this.listeners.set(name, listener);
          this.listening += 1;
          return {
            dispose: (): void => {
              this.listening -= 1;
            },
          };
        };
      const model: unknown = {
        getAllDecorations: (): unknown[] =>
          this.folded.map((line: number): unknown => ({
            options: { afterContentClassName: 'inline-folded' },
            range: { startLineNumber: line },
          })),
        getLineContent: (): string => 'void f() {',
        getLineMaxColumn: (): number => 11,
      };
      return {
        createDecorationsCollection: (): unknown => ({
          set: (next: unknown): void => void this.written.push(next),
          clear: (): void => void (this.cleared += 1),
        }),
        onDidChangeHiddenAreas: listen('hidden'),
        onDidChangeModel: listen('model'),
        onMouseDown: listen('mouse'),
        getModel: (): unknown => (this.modelPresent ? model : null),
        setPosition: (position: unknown): void => {
          this.position = position;
        },
        getAction: (): unknown => ({
          run: (): Promise<void> => {
            this.unfolded += 1;
            return Promise.resolve();
          },
        }),
      } as unknown as MonacoApi.editor.IStandaloneCodeEditor;
    }
  }

  /**
   * A Monaco with only the range type the controller builds.
   */
  const monaco: typeof MonacoApi = {
    Range: class {
      public constructor(public readonly line: number) {}
    },
  } as unknown as typeof MonacoApi;

  let stand: StandInEditor;
  let controller: FoldingPlaceholderController;

  /**
   * Clicks a position in the editor.
   * @param lineNumber The line.
   * @param column The column.
   */
  function click(lineNumber: number, column: number): void {
    stand.fire('mouse', { target: { position: { lineNumber, column } } });
  }

  beforeEach(() => {
    stand = new StandInEditor();
    controller = new FoldingPlaceholderController(monaco, stand.editor());
  });

  it('drawsAPlaceholder_onEachFoldedLine', () => {
    stand.folded = [3, 8];

    stand.fire('hidden');

    expect(stand.written.at(-1)).toHaveLength(2);
  });

  it('clearsEverything_whenTheEditorLosesItsModel', () => {
    stand.folded = [3];
    stand.fire('hidden');
    stand.modelPresent = false;

    stand.fire('model');
    stand.modelPresent = true;
    click(3, 11);

    expect(stand.cleared).toBe(1);
    expect(stand.unfolded).toBe(0);
  });

  it('unfolds_whenThePlaceholderIsClicked', () => {
    stand.folded = [3];
    stand.fire('hidden');

    click(3, 11);

    expect(stand.unfolded).toBe(1);
    expect(stand.position).toEqual({ lineNumber: 3, column: 1 });
  });

  it('leavesAClickInTheLinesText', () => {
    stand.folded = [3];
    stand.fire('hidden');

    click(3, 4);

    expect(stand.unfolded).toBe(0);
  });

  it('leavesAClickOnALineThatIsNotFolded', () => {
    stand.folded = [3];
    stand.fire('hidden');

    click(4, 11);

    expect(stand.unfolded).toBe(0);
  });

  it('leavesAClickOutsideTheText', () => {
    stand.folded = [3];
    stand.fire('hidden');

    stand.fire('mouse', { target: { position: null } });

    expect(stand.unfolded).toBe(0);
  });

  it('dispose_stopsListeningAndClears', () => {
    controller.dispose();

    expect(stand.listening).toBe(0);
    expect(stand.cleared).toBe(1);
  });
});
