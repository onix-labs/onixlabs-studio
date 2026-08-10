import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protocol } from 'electron';
import { logger } from './logger';

/**
 * The custom URL scheme the renderer references local images through. A markdown image whose source is
 * a local path is rewritten to a `studio-media://` URL carrying the document's directory and the
 * original source; this protocol resolves that to a file on disk and streams it back. Keeping the
 * loader in the main process is what lets the renderer's strict Content-Security-Policy continue to
 * forbid `file:` while still showing local images.
 */
export const MEDIA_SCHEME: string = 'studio-media';

/**
 * The image file extensions this protocol is willing to serve. Restricting the loader to images keeps
 * it from becoming a general-purpose reader of arbitrary files off disk.
 */
const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map<string, string>([
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
 * Serves local image files to the renderer over the {@link MEDIA_SCHEME} protocol, resolving each
 * request's source against the requesting document's directory.
 */
export class MediaProtocol {
  /**
   * Registers the media scheme as privileged. Must run before the app is ready (a privileged scheme
   * cannot be declared once the protocol layer has started), so the renderer may load it as a
   * standard, secure, fetchable image source.
   */
  public static registerScheme(): void {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: MEDIA_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
      },
    ]);
  }

  /**
   * Installs the request handler that resolves and streams local image files. Runs once the app is
   * ready.
   */
  public register(): void {
    protocol.handle(MEDIA_SCHEME, (request: Request): Promise<Response> => this.serve(request));
  }

  /**
   * Resolves a media request to a file on disk and returns its bytes, or a 404 response when the
   * request does not name a readable image.
   * @param request The incoming media request.
   * @returns Returns the image response, or a 404 when it cannot be served.
   */
  private async serve(request: Request): Promise<Response> {
    const resolved: { path: string; mime: string } | null = this.resolve(request.url);
    if (resolved === null) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const data: Buffer = await readFile(resolved.path);
      return new Response(new Uint8Array(data), { headers: { 'content-type': resolved.mime } });
    } catch (error: unknown) {
      logger.debug('media', `Media resource unreadable: ${resolved.path}`, error);
      return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Resolves a `studio-media://` request URL to an absolute image path and its MIME type. The request
   * carries the original markdown source and the directory of the document it appeared in; a relative
   * source is resolved against that directory, while an absolute path or `file:` URL is taken as-is.
   * Only image extensions are accepted.
   * @param requestUrl The request URL to resolve.
   * @returns Returns the resolved path and MIME type, or null when the request is not a serveable image.
   */
  private resolve(requestUrl: string): { path: string; mime: string } | null {
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      logger.debug('media', 'Invalid media request URL');
      return null;
    }

    const directory: string = url.searchParams.get('dir') ?? '';
    const rawSource: string | null = url.searchParams.get('src');
    if (rawSource === null || rawSource.length === 0) {
      return null;
    }

    // Drop any query or fragment the markdown source carried, then resolve to an absolute path.
    const source: string = rawSource.replace(/[?#].*$/, '');
    let absolute: string;
    if (source.startsWith('file://')) {
      try {
        absolute = fileURLToPath(source);
      } catch {
        logger.debug('media', 'Invalid file URL in media request');
        return null;
      }
    } else if (isAbsolute(source)) {
      absolute = source;
    } else if (directory.length > 0) {
      absolute = resolve(directory, source);
    } else {
      return null;
    }

    const mime: string | undefined = IMAGE_EXTENSIONS.get(extname(absolute).toLowerCase());
    return mime === undefined ? null : { path: absolute, mime };
  }
}
