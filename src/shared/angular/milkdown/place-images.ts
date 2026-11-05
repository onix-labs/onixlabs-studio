import type { EditorView } from '@milkdown/kit/prose/view';
import { insertImage } from './markdown-paste';

/**
 * Stores one image, then puts it in the document unless the editor has gone in the meantime.
 * @param view The editor view.
 * @param file The image file.
 * @param store Stores an image and resolves to its source.
 * @param position The position to insert at, or undefined for the selection.
 * @param report Told when the image could not be placed.
 * @returns Returns a promise that settles once the image is placed or given up on; it never rejects.
 */
async function placeImage(
  view: EditorView,
  file: File,
  store: (file: File) => Promise<string>,
  position: number | undefined,
  report: (file: File, cause: unknown) => void,
): Promise<void> {
  try {
    const source: string = await store(file);
    // An image that could not be read comes back empty, and would leave a broken block in the document.
    if (source.length === 0) {
      report(file, 'The image could not be read');
      return;
    }
    // Storing can outlast the editor: the tab may close while the image is being written.
    if (!view.isDestroyed) {
      insertImage(view, source, file.name, position);
    }
  } catch (error: unknown) {
    // Nothing awaits a paste or a drop, so a failure not caught here is an unhandled rejection.
    report(file, error);
  }
}

/**
 * Pastes image files at a position, once each has been stored.
 * @param view The editor view.
 * @param files The image files.
 * @param store Stores an image and resolves to its source.
 * @param report Told about each image that could not be placed.
 * @param position The position to insert at, or undefined for the selection.
 */
export function placeImages(
  view: EditorView,
  files: readonly File[],
  store: (file: File) => Promise<string>,
  report: (file: File, cause: unknown) => void,
  position?: number,
): void {
  for (const file of files) {
    // Handled inside: the paste has already returned, and each image lands when it is ready.
    void placeImage(view, file, store, position, report);
  }
}
