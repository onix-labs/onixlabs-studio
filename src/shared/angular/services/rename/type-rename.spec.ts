import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { Mock } from 'vitest';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import type { CodeSymbol } from '@shared/angular/services/lsp/lsp-symbols';
import type { WorkspaceTextEdits } from '@shared/angular/services/workspace-edit/workspace-edit';
import { TypeRename } from './type-rename';

/**
 * Builds a symbol whose name starts at a line.
 * @param name The symbol's name.
 * @param kind Its protocol kind.
 * @param line The zero-based line its name is on.
 * @param children The symbols inside it.
 * @returns Returns the symbol.
 */
function symbol(
  name: string,
  kind: number,
  line: number,
  children: readonly CodeSymbol[] = [],
): CodeSymbol {
  const range: CodeSymbol['range'] = {
    start: { line, character: 21 },
    end: { line, character: 21 + name.length },
  };
  return { name, kind, range, selectionRange: range, children };
}

/**
 * The edits a server answers a type rename with.
 */
const EDITS: WorkspaceTextEdits = {
  files: [{ path: '/ws/Enumeration.cs', edits: [] }],
  refused: [],
};

describe('TypeRename', () => {
  let open: string | undefined;
  let opened: string[];
  let symbols: readonly CodeSymbol[] | null;
  let rename: Mock<LspFeatures['rename']>;
  const model: MonacoApi.editor.ITextModel = {} as MonacoApi.editor.ITextModel;

  /**
   * Builds the service with its collaborators faked.
   * @returns Returns it.
   */
  function build(): TypeRename {
    TestBed.configureTestingModule({
      providers: [
        TypeRename,
        {
          provide: Editors,
          useValue: {
            modelUriForPath: (path: string): string | undefined =>
              path === open ? 'inmemory://model/1' : undefined,
          },
        },
        {
          provide: FileOpener,
          useValue: {
            openPath: (path: string): Promise<boolean> => {
              opened.push(path);
              open = path;
              return Promise.resolve(true);
            },
          },
        },
        {
          provide: LspFeatures,
          useValue: {
            documentSymbols: (): Promise<readonly CodeSymbol[] | null> => Promise.resolve(symbols),
            rename,
          },
        },
      ],
    });
    return TestBed.inject(TypeRename);
  }

  beforeEach((): void => {
    open = '/ws/Enumeration.cs';
    opened = [];
    symbols = [symbol('OnixLabs.Core', 3, 0, [symbol('Enumeration<T>', 5, 2)])];
    rename = vi.fn<LspFeatures['rename']>().mockResolvedValue({ kind: 'edits', edits: EDITS });
    (window as unknown as { monaco: unknown }).monaco = {
      Uri: { parse: (uri: string): string => uri },
      editor: { getModel: (): MonacoApi.editor.ITextModel => model },
    };
  });

  afterEach((): void => {
    delete (window as unknown as { monaco?: unknown }).monaco;
  });

  it('renamesTheTypeTheFileIsNamedAfter_whereverItIsDeclared', async () => {
    await expect(build().editsFor('/ws/Enumeration.cs', 'Enumeration', 'Ordinal')).resolves.toBe(
      EDITS,
    );

    expect(rename).toHaveBeenCalledWith(model, { lineNumber: 3, column: 22 }, 'Ordinal');
    expect(opened).toEqual([]);
  });

  it('opensAFileThatIsNotOpen_behindWhatTheUserIsReading', async () => {
    open = undefined;

    await build().editsFor('/ws/Enumeration.cs', 'Enumeration', 'Ordinal');

    expect(opened).toEqual(['/ws/Enumeration.cs']);
    expect(rename).toHaveBeenCalled();
  });

  it('answersNothing_whenTheFileDeclaresNoTypeOfItsName', async () => {
    symbols = [symbol('Extensions', 5, 0)];

    await expect(build().editsFor('/ws/Enumeration.cs', 'Enumeration', 'Ordinal')).resolves.toBe(
      null,
    );
    expect(rename).not.toHaveBeenCalled();
  });

  it('answersNothing_forANameThatIsNoIdentifier', async () => {
    await expect(build().editsFor('/ws/Enumeration.cs', 'Enumeration', 'Ord-inal')).resolves.toBe(
      null,
    );
  });

  it('answersNothing_whenTheServerRefuses', async () => {
    rename.mockResolvedValue({ kind: 'refused', reason: 'No' });

    await expect(build().editsFor('/ws/Enumeration.cs', 'Enumeration', 'Ordinal')).resolves.toBe(
      null,
    );
  });
});
