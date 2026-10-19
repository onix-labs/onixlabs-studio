import { FILE_OPERATION_REFUSED, fromLspWorkspaceEdit, WorkspaceTextEdits } from './workspace-edit';

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
          { kind: 'create', uri: 'file:///ws/made.ts' },
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
