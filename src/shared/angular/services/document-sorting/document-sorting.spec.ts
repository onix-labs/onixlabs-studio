import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import { LspCommandOutcome, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { DocumentSorting } from './document-sorting';

/**
 * A stand-in for the language-server features Sort Document asks: whether the document's server
 * sorts, and what a sort came to.
 */
class FakeLspFeatures {
  public serves: boolean = true;
  public outcome: LspCommandOutcome = { ran: true };
  public readonly sorted: unknown[] = [];

  public servesDocumentSorting(): boolean {
    return this.serves;
  }

  public sortDocument(model: unknown): Promise<LspCommandOutcome> {
    this.sorted.push(model);
    return Promise.resolve(this.outcome);
  }
}

/**
 * Builds a stand-in editor showing a model.
 * @param model The model, or null for an editor with none.
 * @param readOnly Whether the editor is read-only.
 * @returns Returns the editor.
 */
function editorOf(model: unknown, readOnly: boolean = false): MonacoApi.editor.ICodeEditor {
  const editor: unknown = {
    getModel: (): unknown => model,
    getRawOptions: (): MonacoApi.editor.IEditorOptions => ({ readOnly }),
  };
  return editor as MonacoApi.editor.ICodeEditor;
}

describe('DocumentSorting (#1214)', () => {
  const model: unknown = { uri: { toString: (): string => 'file:///root/package.json' } };
  let lsp: FakeLspFeatures;
  let sorting: DocumentSorting;
  let raised: NotificationRequest[];

  beforeEach(() => {
    lsp = new FakeLspFeatures();
    TestBed.configureTestingModule({ providers: [{ provide: LspFeatures, useValue: lsp }] });
    sorting = TestBed.inject(DocumentSorting);
    raised = [];
    vi.spyOn(TestBed.inject(Notifications), 'notify').mockImplementation(
      (notification: NotificationRequest): void => void raised.push(notification),
    );
  });

  it('isOffered_whereTheDocumentsServerSorts', () => {
    expect(sorting.offersSortDocument(editorOf(model))).toBe(true);

    lsp.serves = false;
    expect(sorting.offersSortDocument(editorOf(model))).toBe(false);
    expect(sorting.offersSortDocument(editorOf(null))).toBe(false);
  });

  it('isNamedSortDocument', () => {
    expect(sorting.label).toBe('Sort Document');
  });

  it('sortDocument_sortsTheEditorsModel_sayingNothingWhenItWorks', async () => {
    await sorting.sortDocument(editorOf(model));

    expect(lsp.sorted).toEqual([model]);
    expect(raised).toEqual([]);
  });

  it('sortDocument_saysWhy_whenTheServerCouldNotSort', async () => {
    lsp.outcome = { ran: false, reason: 'Bad JSON.' };

    await sorting.sortDocument(editorOf(model));

    expect(raised).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: "Couldn't sort the document",
        detail: 'Bad JSON.',
      }),
    ]);
  });

  it('sortDocument_leavesAReadOnlyEditorAlone', async () => {
    await sorting.sortDocument(editorOf(model, true));

    expect(lsp.sorted).toEqual([]);
  });
});
