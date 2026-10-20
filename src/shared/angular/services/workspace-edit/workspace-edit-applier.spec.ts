import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { TextEditsRequest, TextEditsResponse } from '@shared/api/search-channels';
import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Search } from '@shared/angular/services/search/search';
import { TextEditEntry, WorkspaceEditOutcome } from './workspace-edit';
import { WorkspaceEditApplier } from './workspace-edit-applier';

/**
 * A fake model recording the undo stops and edit operations pushed onto it.
 */
interface FakeModel {
  readonly model: MonacoApi.editor.ITextModel;
  readonly calls: (string | readonly MonacoApi.editor.IIdentifiedSingleEditOperation[])[];
}

/**
 * Builds a fake model.
 * @param uri Its URI.
 * @returns Returns the model and its recorder.
 */
function fakeModel(uri: string): FakeModel {
  const calls: FakeModel['calls'] = [];
  const model: unknown = {
    uri: { toString: (): string => uri },
    isDisposed: (): boolean => false,
    pushStackElement: (): number => calls.push('undo stop'),
    pushEditOperations: (
      _before: unknown,
      operations: readonly MonacoApi.editor.IIdentifiedSingleEditOperation[],
    ): null => {
      calls.push(operations);
      return null;
    },
  };
  return { model: model as MonacoApi.editor.ITextModel, calls };
}

/**
 * Builds an edit on one line.
 * @param line The one-based line.
 * @param start The one-based start column.
 * @param end The one-based end column.
 * @param text The replacement.
 * @returns Returns the edit.
 */
function edit(line: number, start: number, end: number, text: string): TextEditEntry {
  return {
    range: { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end },
    text,
  };
}

describe('WorkspaceEditApplier (#1015)', () => {
  let models: MonacoApi.editor.ITextModel[];
  let requests: TextEditsRequest[];
  let response: (request: TextEditsRequest) => TextEditsResponse;

  beforeEach(() => {
    models = [];
    requests = [];
    response = (request: TextEditsRequest): TextEditsResponse => ({
      written: request.files.map((file: TextEditsRequest['files'][number]) => ({
        path: file.path,
        edits: file.edits.length,
      })),
      failed: [],
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Monaco,
          useValue: {
            getMonaco: (): unknown => ({ editor: { getModels: (): unknown[] => models } }),
          },
        },
        {
          provide: Search,
          useValue: {
            applyTextEdits: (request: TextEditsRequest): Promise<TextEditsResponse> => {
              requests.push(request);
              return Promise.resolve(response(request));
            },
          },
        },
      ],
    });
  });

  it('editsAnOpenFileInItsEditor_inOneUndoStop_lastEditFirst', async () => {
    const open: FakeModel = fakeModel('inmemory://model/1');
    models.push(open.model);
    TestBed.inject(Editors).register('inmemory://model/1', {
      documentId: 'doc-1',
      path: '/ws/a.ts',
      name: 'a.ts',
    });

    const outcome: WorkspaceEditOutcome = await TestBed.inject(WorkspaceEditApplier).apply({
      files: [{ path: '/ws/a.ts', edits: [edit(1, 7, 11, 'id'), edit(4, 1, 5, 'id')] }],
      refused: [],
    });

    expect(outcome).toEqual({
      applied: [{ path: '/ws/a.ts', edits: 2, where: 'editor' }],
      skipped: [],
    });
    expect(open.calls).toEqual([
      'undo stop',
      [
        { range: edit(4, 1, 5, 'id').range, text: 'id', forceMoveMarkers: true },
        { range: edit(1, 7, 11, 'id').range, text: 'id', forceMoveMarkers: true },
      ],
      'undo stop',
    ]);
    expect(requests).toEqual([]);
  });

  it('writesAClosedFileOnDisk_andEditsADocumentWithNoFileByItsModel', async () => {
    const untitled: FakeModel = fakeModel('inmemory://model/7');
    models.push(untitled.model);

    const outcome: WorkspaceEditOutcome = await TestBed.inject(WorkspaceEditApplier).apply({
      files: [
        { path: '/ws/closed.ts', edits: [edit(2, 3, 7, 'id')] },
        { path: 'inmemory://model/7', edits: [edit(1, 1, 2, 'x')] },
      ],
      refused: [],
    });

    expect(requests).toEqual([
      {
        files: [
          {
            path: '/ws/closed.ts',
            edits: [
              { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7, text: 'id' },
            ],
          },
        ],
      },
    ]);
    expect(outcome.applied).toEqual([
      { path: 'inmemory://model/7', edits: 1, where: 'editor' },
      { path: '/ws/closed.ts', edits: 1, where: 'disk' },
    ]);
    expect(untitled.calls.length).toBe(3);
  });

  it('namesEverythingSkipped_refusedParts_overlaps_unknownModels_andWhatTheDiskRefused', async () => {
    const open: FakeModel = fakeModel('inmemory://model/1');
    models.push(open.model);
    TestBed.inject(Editors).register('inmemory://model/1', {
      documentId: 'doc-1',
      path: '/ws/a.ts',
      name: 'a.ts',
    });
    response = (request: TextEditsRequest): TextEditsResponse => ({
      written: [],
      failed: request.files.map((file: TextEditsRequest['files'][number]) => ({
        path: file.path,
        reason: 'It is outside the workspace.',
      })),
    });

    const outcome: WorkspaceEditOutcome = await TestBed.inject(WorkspaceEditApplier).apply({
      files: [
        { path: '/ws/a.ts', edits: [edit(1, 1, 5, 'x'), edit(1, 3, 6, 'y')] },
        { path: 'inmemory://model/gone', edits: [edit(1, 1, 2, 'x')] },
        { path: '/elsewhere/b.ts', edits: [edit(1, 1, 2, 'x')] },
      ],
      refused: [
        { path: '/ws/old.ts', reason: "Creating, renaming or deleting files isn't supported yet." },
      ],
    });

    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped).toEqual([
      { path: '/ws/old.ts', reason: "Creating, renaming or deleting files isn't supported yet." },
      { path: '/ws/a.ts', reason: 'Its edits overlap.' },
      { path: 'inmemory://model/gone', reason: "It isn't open, and has no file on disk." },
      { path: '/elsewhere/b.ts', reason: 'It is outside the workspace.' },
    ]);
    expect(open.calls).toEqual([]);
  });
});
