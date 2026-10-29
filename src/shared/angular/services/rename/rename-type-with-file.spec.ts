import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { LspCodeAction, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { CodeSymbol, SymbolKind } from '@shared/angular/services/lsp/lsp-symbols';
import {
  RenameConfirmation,
  RenameConfirmationRequest,
} from '@shared/angular/services/rename/rename-confirmation';
import type {
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import {
  isIdentifier,
  RENAME_TYPE_SETTLE_DELAYS_MS,
  RenameTypeWithFile,
  renameTypeAction,
  typeNameChange,
  typeNamed,
} from './rename-type-with-file';

/**
 * The renamed file's old path.
 */
const OLD_PATH: string = '/root/Fixture.Core/IGreeter.cs';

/**
 * Its new path.
 */
const NEW_PATH: string = '/root/Fixture.Core/Greeter.cs';

/**
 * Builds a symbol.
 * @param name Its name.
 * @param kind Its kind.
 * @param children The symbols inside it.
 * @returns Returns the symbol, its name on line 4 (zero-based 3), from character 17.
 */
function symbol(name: string, kind: number, children: readonly CodeSymbol[] = []): CodeSymbol {
  return {
    name,
    kind,
    range: { start: { line: 3, character: 0 }, end: { line: 9, character: 1 } },
    selectionRange: { start: { line: 3, character: 17 }, end: { line: 3, character: 25 } },
    children,
  };
}

/**
 * Builds a server's code action.
 * @param title The title.
 * @param extra What else it is.
 * @returns Returns the action.
 */
function action(title: string, extra: Partial<LspCodeAction> = {}): LspCodeAction {
  return {
    title,
    kind: 'refactor',
    isPreferred: false,
    disabledReason: null,
    edit: null,
    command: null,
    raw: { title },
    ...extra,
  };
}

/**
 * The refactorings Roslyn 5.13 offers at `IGreeter` in a file renamed to `Greeter.cs`.
 */
const OFFERED: readonly LspCodeAction[] = [
  action('Rename file to IGreeter.cs'),
  action('Rename type to Greeter'),
  action('Extract interface...', { kind: 'refactor.extract' }),
];

/**
 * The edit Roslyn resolves "Rename type to Greeter" to, in two files.
 */
const EDIT: WorkspaceTextEdits = {
  files: [
    {
      path: NEW_PATH,
      edits: [
        {
          range: { startLineNumber: 4, startColumn: 18, endLineNumber: 4, endColumn: 19 },
          text: '',
        },
      ],
    },
    {
      path: '/root/Fixture.App/Program.cs',
      edits: [
        {
          range: { startLineNumber: 5, startColumn: 15, endLineNumber: 5, endColumn: 16 },
          text: '',
        },
        {
          range: { startLineNumber: 7, startColumn: 10, endLineNumber: 7, endColumn: 11 },
          text: '',
        },
      ],
    },
  ],
  refused: [],
};

describe('typeNameChange (#1152)', () => {
  it('reads the old and new type names from a file renamed in its folder', () => {
    expect(typeNameChange(OLD_PATH, NEW_PATH)).toEqual({ oldName: 'IGreeter', newName: 'Greeter' });
    expect(typeNameChange('C:\\src\\Person.cs', 'C:\\src\\Customer.cs')).toEqual({
      oldName: 'Person',
      newName: 'Customer',
    });
  });

  it('implies no type name for a move, a new extension, a dotted name or a non-identifier', () => {
    expect(typeNameChange(OLD_PATH, '/root/Fixture.Services/Greeter.cs')).toBeNull();
    expect(typeNameChange(OLD_PATH, '/root/Fixture.Core/Greeter.txt')).toBeNull();
    expect(typeNameChange('/root/Form1.Designer.cs', '/root/Main.Designer.cs')).toBeNull();
    expect(typeNameChange(OLD_PATH, '/root/Fixture.Core/my-greeter.cs')).toBeNull();
    expect(typeNameChange(OLD_PATH, '/root/Fixture.Core/2Greeter.cs')).toBeNull();
    expect(typeNameChange('/root/Models', '/root/Entities')).toBeNull();
    expect(typeNameChange(OLD_PATH, OLD_PATH)).toBeNull();
  });

  it('takes letters, digits and underscores as an identifier, not a leading digit', () => {
    expect(isIdentifier('Greeter_2')).toBe(true);
    expect(isIdentifier('Größe')).toBe(true);
    expect(isIdentifier('_internal')).toBe(true);
    expect(isIdentifier('2fast')).toBe(false);
    expect(isIdentifier('a b')).toBe(false);
    expect(isIdentifier('')).toBe(false);
  });
});

describe('typeNamed (#1152)', () => {
  it('finds a type of the name inside its namespace, a generic one by its bare name', () => {
    const greeter: CodeSymbol = symbol('IGreeter', SymbolKind.Interface);
    expect(typeNamed([symbol('Fixture.Core', SymbolKind.Namespace, [greeter])], 'IGreeter')).toBe(
      greeter,
    );
    const repository: CodeSymbol = symbol('Repository<T>', SymbolKind.Class);
    expect(typeNamed([repository], 'Repository')).toBe(repository);
  });

  it('finds no member, and no type nested in another, of the name', () => {
    const nested: CodeSymbol = symbol('Outer', SymbolKind.Class, [
      symbol('IGreeter', SymbolKind.Interface),
    ]);
    expect(typeNamed([nested], 'IGreeter')).toBeNull();
    expect(typeNamed([symbol('IGreeter', SymbolKind.Method)], 'IGreeter')).toBeNull();
    expect(typeNamed([symbol('Greeter', SymbolKind.Class)], 'IGreeter')).toBeNull();
  });
});

describe('renameTypeAction (#1152)', () => {
  it("chooses Roslyn's rename of the type, not its rename of the file back", () => {
    expect(renameTypeAction(OFFERED, { oldName: 'IGreeter', newName: 'Greeter' })?.title).toBe(
      'Rename type to Greeter',
    );
    // The other way round, "Rename file to Greeter.cs" names the old name and is passed over.
    expect(
      renameTypeAction([action('Rename file to Greeter.cs'), action('Rename type to IGreeter')], {
        oldName: 'Greeter',
        newName: 'IGreeter',
      })?.title,
    ).toBe('Rename type to IGreeter');
  });

  it('takes a lone refactoring naming the new name whatever its wording', () => {
    expect(
      renameTypeAction([action('Typ in „Greeter“ umbenennen')], {
        oldName: 'IGreeter',
        newName: 'Greeter',
      })?.title,
    ).toBe('Typ in „Greeter“ umbenennen');
  });

  it('chooses nothing when no refactoring renames the type, or it is disabled or not a refactoring', () => {
    const change: { oldName: string; newName: string } = {
      oldName: 'IGreeter',
      newName: 'Greeter',
    };
    expect(renameTypeAction([OFFERED[0], OFFERED[2]], change)).toBeNull();
    expect(
      renameTypeAction([action('Rename type to Greeter', { disabledReason: 'No.' })], change),
    ).toBeNull();
    expect(
      renameTypeAction([action('Rename type to Greeter', { kind: 'quickfix' })], change),
    ).toBeNull();
    expect(renameTypeAction([], change)).toBeNull();
  });
});

describe('RenameTypeWithFile (#1152)', () => {
  let lsp: {
    servesFileCodeActions: Mock<LspFeatures['servesFileCodeActions']>;
    fileSymbols: Mock<LspFeatures['fileSymbols']>;
    fileCodeActions: Mock<LspFeatures['fileCodeActions']>;
    resolveFileCodeAction: Mock<LspFeatures['resolveFileCodeAction']>;
  };
  let applied: WorkspaceTextEdits[];
  let asked: RenameConfirmationRequest[];
  let answer: boolean;

  /**
   * Builds the service.
   * @returns Returns it.
   */
  function build(): RenameTypeWithFile {
    TestBed.configureTestingModule({
      providers: [
        { provide: LspFeatures, useValue: lsp },
        {
          provide: WorkspaceEditApplier,
          useValue: {
            apply: (edit: WorkspaceTextEdits): Promise<WorkspaceEditOutcome> => {
              applied.push(edit);
              return Promise.resolve({ applied: [], skipped: [] });
            },
          },
        },
      ],
    });
    vi.spyOn(TestBed.inject(RenameConfirmation), 'ask').mockImplementation(
      (request: RenameConfirmationRequest): Promise<boolean> => {
        asked.push(request);
        return Promise.resolve(answer);
      },
    );
    return TestBed.inject(RenameTypeWithFile);
  }

  /**
   * Offers the rename, letting every settle delay pass.
   * @param service The service.
   * @returns Returns a promise that resolves once the offer has run its course.
   */
  async function offer(service: RenameTypeWithFile): Promise<void> {
    const done: Promise<void> = service.offer(OLD_PATH, NEW_PATH);
    for (const delay of RENAME_TYPE_SETTLE_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    await done;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    applied = [];
    asked = [];
    answer = true;
    lsp = {
      servesFileCodeActions: vi.fn<LspFeatures['servesFileCodeActions']>((): boolean => true),
      fileSymbols: vi.fn<LspFeatures['fileSymbols']>((): Promise<readonly CodeSymbol[] | null> =>
        Promise.resolve([
          symbol('Fixture.Core', SymbolKind.Namespace, [symbol('IGreeter', SymbolKind.Interface)]),
        ]),
      ),
      fileCodeActions: vi.fn<LspFeatures['fileCodeActions']>(
        (): Promise<readonly LspCodeAction[] | null> => Promise.resolve(OFFERED),
      ),
      resolveFileCodeAction: vi.fn<LspFeatures['resolveFileCodeAction']>(
        (_path: string, chosen: LspCodeAction): Promise<LspCodeAction> =>
          Promise.resolve({ ...chosen, edit: EDIT }),
      ),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('asks for refactorings at the type, and applies its rename once the user goes ahead', async () => {
    await offer(build());
    expect(lsp.fileCodeActions).toHaveBeenCalledWith(
      NEW_PATH,
      { startLineNumber: 4, startColumn: 18, endLineNumber: 4, endColumn: 18 },
      ['refactor'],
    );
    expect(lsp.resolveFileCodeAction.mock.calls[0][1].title).toBe('Rename type to Greeter');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      title: 'Rename type to Greeter?',
      confirmLabel: 'Rename Type',
      cancelLabel: 'Rename File Only',
    });
    expect(asked[0].files.map((file) => file.name)).toEqual(['Greeter.cs', 'Program.cs']);
    expect(applied).toEqual([EDIT]);
  });

  it('keeps the file rename alone when the user declines', async () => {
    answer = false;
    await offer(build());
    expect(asked).toHaveLength(1);
    expect(applied).toEqual([]);
  });

  it('asks again while the server catches up with the rename', async () => {
    lsp.fileCodeActions
      .mockResolvedValueOnce([OFFERED[2]])
      .mockResolvedValueOnce([OFFERED[2]])
      .mockResolvedValue(OFFERED);
    await offer(build());
    expect(lsp.fileCodeActions).toHaveBeenCalledTimes(3);
    expect(applied).toEqual([EDIT]);
  });

  it('does nothing, and says nothing, when no rename of the type is offered', async () => {
    lsp.fileCodeActions.mockResolvedValue([OFFERED[0], OFFERED[2]]);
    await offer(build());
    expect(lsp.fileCodeActions).toHaveBeenCalledTimes(RENAME_TYPE_SETTLE_DELAYS_MS.length);
    expect(lsp.resolveFileCodeAction).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
  });

  it('asks nothing of a file declaring no type of its old name', async () => {
    lsp.fileSymbols.mockResolvedValue([symbol('Program', SymbolKind.Class)]);
    await offer(build());
    expect(lsp.fileSymbols).toHaveBeenCalledTimes(1);
    expect(lsp.fileCodeActions).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
  });

  it('asks nothing when no server knows the file, or the rename implies no type name', async () => {
    lsp.servesFileCodeActions.mockReturnValue(false);
    const service: RenameTypeWithFile = build();
    await offer(service);
    await service.offer(OLD_PATH, '/root/Fixture.Core/greeter-impl.cs');
    expect(lsp.fileSymbols).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
  });

  it('offers nothing when the resolved rename has no edit', async () => {
    lsp.resolveFileCodeAction.mockImplementation(
      (_path: string, chosen: LspCodeAction): Promise<LspCodeAction> => Promise.resolve(chosen),
    );
    await offer(build());
    expect(asked).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('abandons an older rename once a newer one starts', async () => {
    const service: RenameTypeWithFile = build();
    const first: Promise<void> = service.offer('/root/Fixture.Core/Old.cs', NEW_PATH);
    const second: Promise<void> = service.offer(OLD_PATH, NEW_PATH);
    for (const delay of RENAME_TYPE_SETTLE_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    await Promise.all([first, second]);
    expect(asked).toHaveLength(1);
    expect(asked[0].oldName).toBe('IGreeter');
  });
});
