import type {
  MarkdownInsertedImagePaths,
  MarkdownPastedImageStorage,
} from '@shared/angular/services/settings/settings-registry';

/**
 * Holds the folder pasted images go in when the setting's name can't be used.
 */
const DEFAULT_FOLDER: string = 'assets';

/**
 * Holds the file extension of each image type a clipboard carries.
 */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/**
 * Determines whether an image source is a path on this machine.
 * @param source The image source.
 * @returns Returns true for an absolute path.
 */
function isAbsolutePath(source: string): boolean {
  return source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source);
}

/**
 * Splits a path into its segments, whichever separator it uses.
 * @param path The path.
 * @returns Returns the non-empty segments.
 */
function segments(path: string): readonly string[] {
  return path.split(/[\\/]/).filter((segment: string): boolean => segment.length > 0);
}

/**
 * Writes the path to a local image the way the Inserted Image Paths setting asks. An address, a path
 * already relative, or a document with no folder yet stays as it is.
 * @param source The image's source.
 * @param directory The document's folder, or the empty string before it is saved.
 * @param style The Inserted Image Paths setting.
 * @returns Returns the source to write.
 */
export function styleImagePath(
  source: string,
  directory: string,
  style: MarkdownInsertedImagePaths,
): string {
  if (style === 'absolute' || directory.length === 0 || !isAbsolutePath(source)) {
    return source;
  }
  const from: readonly string[] = segments(directory);
  const to: readonly string[] = segments(source);
  let shared: number = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  // Nothing in common means another drive, where only the absolute path says where the file is.
  if (shared === 0) {
    return source;
  }
  return [...from.slice(shared).map((): string => '..'), ...to.slice(shared)].join('/');
}

/**
 * Names the file a pasted image is saved under.
 * @param file The pasted image.
 * @param now The time of the paste, in milliseconds.
 * @returns Returns the file's name.
 */
export function pastedImageFileName(file: File, now: number): string {
  return `pasted-image-${now}.${IMAGE_EXTENSIONS[file.type] ?? 'png'}`;
}

/**
 * Finds where a pasted image is saved.
 * @param directory The document's folder.
 * @param storage The Pasted Image Storage setting.
 * @param folder The Pasted Image Folder setting.
 * @param fileName The image's file name.
 * @returns Returns the absolute path to save at.
 */
export function pastedImagePath(
  directory: string,
  storage: MarkdownPastedImageStorage,
  folder: string,
  fileName: string,
): string {
  const separator: string = directory.includes('\\') ? '\\' : '/';
  if (storage !== 'folder') {
    return `${directory}${separator}${fileName}`;
  }
  // One folder beside the document: a name that leads anywhere else falls back to the default.
  const name: string = folder.trim();
  const usable: boolean = name.length > 0 && !/[\\/]/.test(name) && name !== '.' && name !== '..';
  return `${directory}${separator}${usable ? name : DEFAULT_FOLDER}${separator}${fileName}`;
}
