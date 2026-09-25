/**
 * Maps each image file extension Studio can display to its MIME type. It is the one list both sides
 * read: the main process serves these (and only these) over the `studio-media://` protocol, and
 * classifies a file with one of these extensions as an image before its binary sniff — so the two can
 * never disagree about what an image is.
 *
 * Every entry is a format Chromium decodes. Formats it cannot (TIFF, HEIC, PSD, RAW) are deliberately
 * absent and stay in the binary editor.
 */
export const IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'],
  ['.svg', 'image/svg+xml'],
  ['.apng', 'image/apng'],
]);

/**
 * Names the formats Chromium's `canvas.toBlob` can encode — the only ones an edited image can be
 * written back in, and the choices Export As offers.
 */
export type EncodableImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * Lists the encodable formats in the order Export As offers them.
 */
export const ENCODABLE_IMAGE_TYPES: readonly EncodableImageType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

/**
 * Extracts a path's lowercased extension, including the leading dot, or an empty string when it has
 * none. Written without `node:path` so the renderer can share it.
 * @param path The file path or name.
 * @returns Returns the lowercased extension, or an empty string.
 */
export function imageExtensionOf(path: string): string {
  const name: string = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot: number = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Resolves the image MIME type of a path from its extension.
 * @param path The file path or name.
 * @returns Returns the MIME type, or undefined when the path is not a displayable image.
 */
export function imageMimeTypeOf(path: string): string | undefined {
  return IMAGE_MIME_TYPES.get(imageExtensionOf(path));
}

/**
 * Determines whether a MIME type is one an edited image can be written back in.
 * @param mime The MIME type.
 * @returns Returns true when Chromium can encode the type.
 */
export function isEncodableImageType(mime: string): mime is EncodableImageType {
  return (ENCODABLE_IMAGE_TYPES as readonly string[]).includes(mime);
}
