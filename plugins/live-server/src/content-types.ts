// The content type each kind of file a static site holds is served with (#1062).

/**
 * The type a file is served with when its extension is not listed: bytes, which a browser downloads
 * rather than guesses at. `nosniff` is sent with every response, so it cannot be read as a script.
 */
export const FALLBACK_CONTENT_TYPE: string = 'application/octet-stream';

/**
 * The content type of each extension, lowercased with its dot.
 */
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.xhtml', 'application/xhtml+xml; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.bmp', 'image/bmp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.wasm', 'application/wasm'],
  ['.pdf', 'application/pdf'],
]);

/**
 * Gets the content type a file is served with.
 * @param fileName The file's name or path.
 * @returns Returns its content type.
 */
export function contentTypeOf(fileName: string): string {
  const dot: number = fileName.lastIndexOf('.');
  const slash: number = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  if (dot <= slash) {
    return FALLBACK_CONTENT_TYPE;
  }
  return CONTENT_TYPES.get(fileName.slice(dot).toLowerCase()) ?? FALLBACK_CONTENT_TYPE;
}

/**
 * Determines whether a file is a page the reload script is added to.
 * @param fileName The file's name or path.
 * @returns Returns true for an HTML page.
 */
export function isPage(fileName: string): boolean {
  return contentTypeOf(fileName).startsWith('text/html');
}
