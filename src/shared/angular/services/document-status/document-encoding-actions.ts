import { encodingLabel, type TextEncoding } from '@shared/api/text-encodings';
import type { TextEditor, TextEditorEol } from '@shared/angular/components/text-editor/text-editor';
import type { DocumentStatusActions } from './document-status';
import type { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import type { FileSystem } from '@shared/angular/services/file-system/file-system';

/**
 * Describes what a code surface hands {@link codeDocumentActions}: its document, the documents
 * service that holds it, the file system that asks before edits are given up, and its editor pane.
 */
export interface CodeDocumentActionsSource {
  /**
   * Gets the document.
   */
  readonly document: CodeDocument;

  /**
   * Gets the documents service holding it.
   */
  readonly documents: Pick<Documents, 'reopenWithEncoding' | 'saveWithEncoding'>;

  /**
   * Gets the file system, whose native dialog asks before unsaved edits are given up.
   */
  readonly fileSystem: Pick<FileSystem, 'confirmDestructive'>;

  /**
   * Gets the editor pane, or undefined before it exists.
   */
  readonly pane: () => Pick<TextEditor, 'setEol'> | undefined;
}

/**
 * Builds what a code document's status strip can do to it (#1236): reopen its file in an encoding —
 * asking first when that gives up unsaved edits — save it in one, and convert its line endings. A
 * read-only document can only be reopened; one with no file can only be saved and converted.
 * @param source The document and the services that act on it.
 * @returns Returns the actions.
 */
export function codeDocumentActions(source: CodeDocumentActionsSource): DocumentStatusActions {
  const { document, documents, fileSystem } = source;
  const reopen: (encoding: TextEncoding) => Promise<void> = async (
    encoding: TextEncoding,
  ): Promise<void> => {
    if (
      document.dirty() &&
      !(await fileSystem.confirmDestructive({
        title: 'Reopen with encoding?',
        message: `Reopen ${document.fileName()} as ${encodingLabel(encoding)}?`,
        detail: 'Its unsaved changes are discarded, and the file is read again from disk.',
        confirmLabel: 'Reopen',
      }))
    ) {
      return;
    }
    await documents.reopenWithEncoding(document.id, encoding);
  };
  return {
    ...(document.filePath() === null
      ? {}
      : { reopenWithEncoding: (encoding: TextEncoding): void => void reopen(encoding) }),
    ...(document.readOnly()
      ? {}
      : {
          saveWithEncoding: (encoding: TextEncoding): void =>
            void documents.saveWithEncoding(document.id, encoding),
          setEol: (eol: TextEditorEol): void => source.pane()?.setEol(eol),
        }),
  };
}
