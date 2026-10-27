/**
 * Normalises a path for use as a map key and prefix comparison: back-slashes become forward slashes
 * and the drive letter is lower-cased, so the same file always maps to one key.
 * @param path The path to normalise.
 * @returns Returns the normalised path.
 */
export function normalise(path: string): string {
  const slashed: string = path.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
}

/**
 * Converts an absolute file path to a `file:` URI.
 * @param path The absolute path.
 * @returns Returns the file URI.
 */
export function pathToUri(path: string): string {
  const slashed: string = path.replace(/\\/g, '/');
  const absolute: string = slashed.startsWith('/') ? slashed : `/${slashed}`;
  return encodeURI(`file://${absolute}`);
}

/**
 * Converts a `file:` URI back to an absolute path.
 * @param uri The file URI.
 * @returns Returns the absolute path.
 */
export function uriToPath(uri: string): string {
  const withoutScheme: string = decodeURI(uri).replace(/^file:\/\//, '');
  return /^\/[a-zA-Z]:/.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
}

/**
 * Extracts the base name from a path.
 * @param path The path to extract from.
 * @returns Returns the final path segment.
 */
export function basename(path: string): string {
  const segments: string[] = path.split('/');
  return segments[segments.length - 1];
}

/**
 * Gets the parent directory of a path, normalised to forward slashes (the main process resolves it
 * back to a platform path, so the slash form is portable).
 * @param filePath The path whose parent directory is taken.
 * @returns Returns the parent directory.
 */
export function parentDir(filePath: string): string {
  const slashed: string = filePath.replace(/\\/g, '/');
  const index: number = slashed.lastIndexOf('/');
  return index <= 0 ? slashed : slashed.slice(0, index);
}

/**
 * Determines whether a path lies within a root (the root itself or a descendant).
 * @param target The path to test.
 * @param root The workspace root.
 * @returns Returns true when the path is within the root.
 */
export function isWithin(target: string, root: string): boolean {
  const normalisedTarget: string = normalise(target);
  const normalisedRoot: string = normalise(root);
  return normalisedTarget === normalisedRoot || normalisedTarget.startsWith(`${normalisedRoot}/`);
}

/**
 * Determines whether a path is a language server's decompiled source — a file under a
 * `MetadataAsSource` folder, where Roslyn writes the source it answers Go to Definition with for a
 * framework or package symbol (#1133). A shape test only: the main process decides, on real paths,
 * whether such a file may be opened at all.
 * @param target The path to test.
 * @returns Returns true when it has a `MetadataAsSource` folder in it.
 */
export function isMetadataAsSource(target: string): boolean {
  return normalise(target).includes('/MetadataAsSource/');
}
