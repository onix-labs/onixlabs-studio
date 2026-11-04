import { signal } from '@angular/core';
import type { EditorConfigProperties } from '@shared/api/editor-config-channels';
import type { TextEncoding } from '@shared/api/text-encodings';
import type { DocumentStatusActions } from './document-status';
import type { CodeDocument } from '@shared/angular/services/documents/documents';
import { codeDocumentActions, type CodeDocumentActionsSource } from './document-encoding-actions';

describe('codeDocumentActions', () => {
  it('offersNothingAnEditorConfigDecides', () => {
    const actions: DocumentStatusActions = codeDocumentActions(
      source(document({ config: { endOfLine: 'crlf', charset: 'utf-8' } })).source,
    );

    expect(actions.setEol).toBeUndefined();
    expect(actions.saveWithEncoding).toBeUndefined();
    expect(actions.reopenWithEncoding).toBeDefined();
  });

  /**
   * Builds a stand-in document.
   * @param overrides The parts that differ.
   * @returns Returns the document.
   */
  function document(
    overrides: {
      path?: string | null;
      dirty?: boolean;
      readOnly?: boolean;
      config?: EditorConfigProperties;
    } = {},
  ): CodeDocument {
    return {
      id: 'doc',
      filePath: signal(overrides.path === undefined ? '/ws/a.txt' : overrides.path),
      fileName: signal('a.txt'),
      dirty: signal(overrides.dirty ?? false),
      readOnly: signal(overrides.readOnly ?? false),
      editorConfig: signal(overrides.config ?? null),
    } as unknown as CodeDocument;
  }

  /**
   * Builds the source the actions act through, recording what they did.
   * @param doc The document.
   * @param confirm The answer to the discard question.
   * @returns Returns the source and the record.
   */
  function source(
    doc: CodeDocument,
    confirm: boolean = true,
  ): { source: CodeDocumentActionsSource; did: string[] } {
    const did: string[] = [];
    return {
      did,
      source: {
        document: doc,
        documents: {
          reopenWithEncoding: (_id: string, encoding: TextEncoding): Promise<boolean> => {
            did.push(`reopen ${encoding}`);
            return Promise.resolve(true);
          },
          saveWithEncoding: (_id: string, encoding: TextEncoding): Promise<boolean> => {
            did.push(`save ${encoding}`);
            return Promise.resolve(true);
          },
        },
        fileSystem: {
          confirmDestructive: (): Promise<boolean> => {
            did.push('asked');
            return Promise.resolve(confirm);
          },
        },
        pane: () => ({ setEol: (eol: 'LF' | 'CRLF'): void => void did.push(`eol ${eol}`) }),
      },
    };
  }

  it('reopensWithoutAsking_whenThereAreNoEdits', async () => {
    const { source: from, did } = source(document());
    const actions: DocumentStatusActions = codeDocumentActions(from);

    actions.reopenWithEncoding?.('windows1252');
    await Promise.resolve();

    expect(did).toEqual(['reopen windows1252']);
  });

  it('asksBeforeGivingUpEdits_andReopensNothingWhenDeclined', async () => {
    const { source: from, did } = source(document({ dirty: true }), false);

    codeDocumentActions(from).reopenWithEncoding?.('utf8');
    await new Promise((resolve: (value: unknown) => void): void => void setTimeout(resolve));

    expect(did).toEqual(['asked']);
  });

  it('savesAndConvertsLineEndings', () => {
    const { source: from, did } = source(document());
    const actions: DocumentStatusActions = codeDocumentActions(from);

    actions.saveWithEncoding?.('utf16le');
    actions.setEol?.('CRLF');

    expect(did).toEqual(['save utf16le', 'eol CRLF']);
  });

  it('aNewDocument_cannotBeReopened_andAReadOnlyOneCannotBeChanged', () => {
    expect(codeDocumentActions(source(document({ path: null })).source).reopenWithEncoding).toBe(
      undefined,
    );
    const readOnly: DocumentStatusActions = codeDocumentActions(
      source(document({ readOnly: true })).source,
    );
    expect(readOnly.saveWithEncoding).toBeUndefined();
    expect(readOnly.setEol).toBeUndefined();
    expect(readOnly.reopenWithEncoding).toBeDefined();
  });
});
