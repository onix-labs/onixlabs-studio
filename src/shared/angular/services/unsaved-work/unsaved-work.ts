import { ExistingProvider, InjectionToken, Type } from '@angular/core';

/**
 * Identifies a document with unsaved changes.
 */
export interface UnsavedDocument {
  /**
   * Gets the identifier of the document (its owning tab id, or a well document id).
   */
  readonly id: string;

  /**
   * Gets the document's display file name.
   */
  readonly name: string;
}

/**
 * Describes a store of documents whose unsaved changes must be resolved before the window closes.
 * The text {@link import('../documents/documents').Documents} store and each feature's own document
 * model (for example the binary editor's) contribute themselves through {@link provideUnsavedWork},
 * and the Lifecycle service walks every contribution at close time — so the shell prompts for all
 * unsaved work without naming any feature.
 */
export interface UnsavedWorkSource {
  /**
   * Lists the source's documents with unsaved changes, in insertion order.
   * @returns Returns each dirty document's id and display file name.
   */
  dirtyDocuments(): readonly UnsavedDocument[];

  /**
   * Saves one of the source's documents.
   * @param id The identifier of the document to save.
   * @returns Returns true when the document was saved, or false when the user cancelled (for
   * example a save-as dialog), so the close can be aborted.
   */
  save(id: string): Promise<boolean>;
}

/**
 * Names the multi-provider token unsaved-work sources are contributed through.
 */
export const UNSAVED_WORK: InjectionToken<readonly UnsavedWorkSource[]> = new InjectionToken<
  readonly UnsavedWorkSource[]
>('UNSAVED_WORK');

/**
 * Contributes an unsaved-work source.
 * @param source The service class contributing its unsaved documents; resolved via the existing
 * singleton, never a second instance.
 * @returns Returns the multi-provider registering the source.
 */
export function provideUnsavedWork(source: Type<UnsavedWorkSource>): ExistingProvider {
  return { provide: UNSAVED_WORK, useExisting: source, multi: true };
}
