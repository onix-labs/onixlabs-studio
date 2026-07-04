/**
 * Renderer-side helpers for showing local images in the markdown editor.
 *
 * A markdown image whose source is a local path cannot be loaded directly: the renderer's
 * Content-Security-Policy forbids the `file:` scheme, and a relative path would resolve against the
 * app shell rather than the document. Instead, such sources are rewritten to the custom
 * `studio-media://` scheme, which the main process resolves against the document's directory and
 * streams back. Sources that a browser can already load (data, blob, http, https) are left untouched.
 */

/**
 * The custom URL scheme local images are served through; mirrors the main process's `MEDIA_SCHEME`.
 */
const MEDIA_SCHEME: string = 'studio-media';

/**
 * Matches image sources a browser can already load directly, and so must not be rewritten: data and
 * blob URLs, remote http(s) URLs, protocol-relative URLs, and sources already on the media scheme.
 */
const DISPLAYABLE_SOURCE: RegExp = /^(?:data:|blob:|https?:|\/\/|studio-media:)/i;

/**
 * Builds the media-scheme URL that resolves the given source against the given document directory.
 * @param directory The absolute directory of the document the image appears in (may be empty).
 * @param source The original image source from the markdown.
 * @returns Returns the `studio-media://` URL the main process resolves and serves.
 */
function mediaUrl(directory: string, source: string): string {
  const dir: string = encodeURIComponent(directory);
  const src: string = encodeURIComponent(source);
  return `${MEDIA_SCHEME}://image/?dir=${dir}&src=${src}`;
}

/**
 * Rewrites a single image element's source to the media scheme when it names a local file, resolving
 * it against the current document directory. Sources a browser can already load are left as they are.
 * @param image The image element to rewrite.
 * @param getDirectory Supplies the document's current directory.
 */
function resolveImage(image: HTMLImageElement, getDirectory: () => string): void {
  const source: string | null = image.getAttribute('src');
  if (source === null || source.length === 0 || DISPLAYABLE_SOURCE.test(source)) {
    return;
  }
  const url: string = mediaUrl(getDirectory(), source);
  if (image.getAttribute('src') !== url) {
    image.setAttribute('src', url);
  }
}

/**
 * Watches an editor container and rewrites local image sources to the media scheme as images appear or
 * their source changes, so local images render through the main process's loader. Returns a disposer
 * that stops watching.
 * @param container The editor container to watch.
 * @param getDirectory Supplies the document's current directory, against which relative sources resolve.
 * @returns Returns a function that stops watching the container.
 */
export function installImageResolver(
  container: HTMLElement,
  getDirectory: () => string,
): () => void {
  const resolve: (image: HTMLImageElement) => void = (image: HTMLImageElement): void =>
    resolveImage(image, getDirectory);

  container.querySelectorAll('img').forEach(resolve);

  const observer: MutationObserver = new MutationObserver((records: MutationRecord[]): void => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement) {
        resolve(record.target);
        continue;
      }
      record.addedNodes.forEach((node: Node): void => {
        if (node instanceof HTMLImageElement) {
          resolve(node);
        } else if (node instanceof Element) {
          node.querySelectorAll('img').forEach(resolve);
        }
      });
    }
  });

  observer.observe(container, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  return (): void => observer.disconnect();
}

/**
 * Reads an uploaded image file as a self-contained `data:` URL, so a pasted or dropped image is
 * embedded in the document and survives a save and reopen (a blob URL, Crepe's default, does not).
 * @param file The uploaded image file.
 * @returns Returns a promise resolving to the file's data URL, or an empty string when it cannot be read.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve: (value: string) => void): void => {
    const reader: FileReader = new FileReader();
    reader.onload = (): void => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = (): void => resolve('');
    reader.readAsDataURL(file);
  });
}
