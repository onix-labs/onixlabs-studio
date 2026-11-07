import {
  FILE_OPERATION_REFUSED,
  FileTextEdits,
  fromLspWorkspaceEdit,
  movedEdits,
  SkippedEdit,
  WorkspaceTextEdits,
} from './workspace-edit';

/**
 * Maps a `file:` URI to a path, as the language-server features do.
 * @param uri The URI.
 * @returns Returns the path.
 */
function toPath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

/**
 * Builds an LSP text edit on one line.
 * @param line The zero-based line.
 * @param start The zero-based start character.
 * @param end The zero-based end character.
 * @param newText The replacement.
 * @returns Returns the edit.
 */
function lspEdit(line: number, start: number, end: number, newText: string): unknown {
  return {
    range: { start: { line, character: start }, end: { line, character: end } },
    newText,
  };
}

describe('fromLspWorkspaceEdit (#1015)', () => {
  it('readsPerFileChanges_oneBased_inTheServersOrder', () => {
    const edits: WorkspaceTextEdits = fromLspWorkspaceEdit(
      {
        changes: {
          'file:///ws/a.ts': [lspEdit(0, 6, 10, 'id'), lspEdit(3, 0, 4, 'id')],
          'file:///ws/b.ts': [lspEdit(1, 2, 6, 'id')],
        },
      },
      toPath,
    );

    expect(edits).toEqual({
      files: [
        {
          path: '/ws/a.ts',
          edits: [
            {
              range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 11 },
              text: 'id',
            },
            {
              range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 5 },
              text: 'id',
            },
          ],
        },
        {
          path: '/ws/b.ts',
          edits: [
            {
              range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7 },
              text: 'id',
            },
          ],
        },
      ],
      refused: [],
    });
  });

  it('prefersVersionedDocumentChanges_versionsOptional_andRefusesFileOperationsByName', () => {
    const edits: WorkspaceTextEdits = fromLspWorkspaceEdit(
      {
        changes: { 'file:///ws/ignored.ts': [lspEdit(0, 0, 1, 'x')] },
        documentChanges: [
          { textDocument: { uri: 'file:///ws/a.ts', version: 4 }, edits: [lspEdit(0, 0, 4, 'id')] },
          {
            textDocument: { uri: 'file:///ws/b.ts', version: null },
            edits: [{ ...(lspEdit(2, 1, 5, 'id') as object), annotationId: 'rename' }],
          },
          { kind: 'rename', oldUri: 'file:///ws/old.ts', newUri: 'file:///ws/new.ts' },
          { kind: 'delete', uri: 'file:///ws/made.ts' },
        ],
      },
      toPath,
    );

    expect(edits.files.map((file: { path: string }): string => file.path)).toEqual([
      '/ws/a.ts',
      '/ws/b.ts',
    ]);
    expect(edits.files[1]?.edits[0]?.range).toEqual({
      startLineNumber: 3,
      startColumn: 2,
      endLineNumber: 3,
      endColumn: 6,
    });
    expect(edits.refused).toEqual([
      { path: '/ws/old.ts', reason: FILE_OPERATION_REFUSED },
      { path: '/ws/made.ts', reason: FILE_OPERATION_REFUSED },
    ]);
  });

  it('dropsMalformedEdits_andFilesLeftWithNone', () => {
    const edits: WorkspaceTextEdits = fromLspWorkspaceEdit(
      {
        changes: {
          'file:///ws/a.ts': [{ range: { start: { line: -1, character: 0 } }, newText: 'x' }, 3],
          'file:///ws/b.ts': 'nonsense',
        },
      },
      toPath,
    );

    expect(edits).toEqual({ files: [], refused: [] });
    expect(fromLspWorkspaceEdit(null, toPath)).toEqual({ files: [], refused: [] });
  });
});

describe('movedEdits (#1207)', () => {
  /**
   * Builds the edits of the given files, each with no edit in it.
   * @param paths The files.
   * @returns Returns the edits.
   */
  function editsOf(...paths: readonly string[]): WorkspaceTextEdits {
    return {
      files: paths.map((path: string): FileTextEdits => ({ path, edits: [] })),
      refused: [],
    };
  }

  it('reKeysTheEntryAndWhatIsInside_andNothingElse', () => {
    const moved: WorkspaceTextEdits = movedEdits(
      editsOf('/root/src', '/root/src/a.ts', '/root/source/b.ts', '/root/c.ts'),
      '/root/src',
      '/root/lib',
    );

    expect(moved.files.map((file: FileTextEdits): string => file.path)).toEqual([
      '/root/lib',
      '/root/lib/a.ts',
      '/root/source/b.ts',
      '/root/c.ts',
    ]);
  });

  it('readsAWindowsPath', () => {
    const moved: WorkspaceTextEdits = movedEdits(
      editsOf('C:\\root\\src\\a.ts'),
      'C:\\root\\src',
      'C:\\root\\lib',
    );

    expect(moved.files[0].path).toBe('C:\\root\\lib\\a.ts');
  });
});

describe('fromLspWorkspaceEdit: creating a file (#1210)', () => {
  it('readsAFileToCreate_besideTheEditsThatFillIt', () => {
    const edits: WorkspaceTextEdits = fromLspWorkspaceEdit(
      {
        documentChanges: [
          { kind: 'create', uri: 'file:///w/src/nested.rs' },
          {
            textDocument: { uri: 'file:///w/src/nested.rs', version: null },
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: 'pub struct Inner;\n',
              },
            ],
          },
        ],
      },
      toPath,
    );

    expect(edits.creates).toEqual(['/w/src/nested.rs']);
    expect(edits.files.map((file: FileTextEdits): string => file.path)).toEqual([
      '/w/src/nested.rs',
    ]);
    expect(edits.refused).toEqual([]);
  });

  it.each([{ overwrite: true }, { ignoreIfExists: true }])(
    'refusesACreateThatAsks_%j_asAFileThereIsLeftAlone',
    (options: object) => {
      const edits: WorkspaceTextEdits = fromLspWorkspaceEdit(
        { documentChanges: [{ kind: 'create', uri: 'file:///w/a.rs', options }] },
        toPath,
      );

      expect(edits.creates).toBeUndefined();
      expect(edits.refused).toEqual([{ path: '/w/a.rs', reason: FILE_OPERATION_REFUSED }]);
    },
  );

  it('stillRefusesRenamingAndDeleting', () => {
    const edits: WorkspaceTextEdits = fromLspWorkspaceEdit(
      {
        documentChanges: [
          { kind: 'rename', oldUri: 'file:///w/a.rs', newUri: 'file:///w/b.rs' },
          { kind: 'delete', uri: 'file:///w/c.rs' },
        ],
      },
      toPath,
    );

    expect(edits.refused.map((skipped: SkippedEdit): string => skipped.path)).toEqual([
      '/w/a.rs',
      '/w/c.rs',
    ]);
  });
});
