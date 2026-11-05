import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Holds what the mocked protocol layer was given: the privileged schemes and the request handler.
 */
const captured: {
  schemes: { scheme: string; privileges: Record<string, boolean> }[];
  handler: ((request: Request) => Promise<Response>) | null;
} = { schemes: [], handler: null };

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (
      schemes: { scheme: string; privileges: Record<string, boolean> }[],
    ): void => void captured.schemes.push(...schemes),
    handle: (_scheme: string, handler: (request: Request) => Promise<Response>): void => {
      captured.handler = handler;
    },
  },
}));

const { MEDIA_SCHEME, MediaProtocol } = await import('./media-protocol');

describe('MediaProtocol', () => {
  it('registerScheme_isCorsEnabled_soAnImageDrawnFromItLeavesTheCanvasReadable', () => {
    MediaProtocol.registerScheme();

    const registered: { scheme: string; privileges: Record<string, boolean> } | undefined =
      captured.schemes.find((entry) => entry.scheme === MEDIA_SCHEME);
    expect(registered?.privileges['corsEnabled']).toBe(true);
  });

  it('serve_answersAnImageWithACorsHeader_andRefusesAFileThatIsNotAnImage', async () => {
    const directory: string = mkdtempSync(join(tmpdir(), 'media-protocol-'));
    writeFileSync(join(directory, 'photo.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(directory, 'notes.txt'), 'text');
    new MediaProtocol().register();
    const request: (source: string) => Promise<Response> = (source: string): Promise<Response> =>
      captured.handler!(
        new Request(`${MEDIA_SCHEME}://image/?src=${encodeURIComponent(join(directory, source))}`),
      );

    const image: Response = await request('photo.png');
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('access-control-allow-origin')).toBe('*');

    expect((await request('notes.txt')).status).toBe(404);
  });

  /**
   * Requests a file through the installed handler.
   * @param file The absolute path.
   * @returns Returns the response.
   */
  function fetchMedia(file: string): Promise<Response> {
    new MediaProtocol().register();
    return captured.handler!(
      new Request(`${MEDIA_SCHEME}://image/?src=${encodeURIComponent(file)}`),
    );
  }

  it('serve_streamsEveryByteOfAFileLargerThanOneReadBuffer', async () => {
    const directory: string = mkdtempSync(join(tmpdir(), 'media-protocol-'));
    const bytes: Uint8Array = Uint8Array.from({ length: 300_000 }, (_unused, index) => index % 251);
    writeFileSync(join(directory, 'large.png'), bytes);

    const response: Response = await fetchMedia(join(directory, 'large.png'));

    expect(response.headers.get('content-length')).toBe('300000');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('serve_withAnEmptyImage_answersAnEmptyBody', async () => {
    const directory: string = mkdtempSync(join(tmpdir(), 'media-protocol-'));
    writeFileSync(join(directory, 'empty.png'), '');

    const response: Response = await fetchMedia(join(directory, 'empty.png'));

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it('serve_withAMissingFile_answers404', async () => {
    const directory: string = mkdtempSync(join(tmpdir(), 'media-protocol-'));

    expect((await fetchMedia(join(directory, 'gone.png'))).status).toBe(404);
  });

  it('serve_withADirectoryNamedLikeAnImage_answers404', async () => {
    const directory: string = mkdtempSync(join(tmpdir(), 'media-protocol-'));
    mkdirSync(join(directory, 'folder.png'));

    expect((await fetchMedia(join(directory, 'folder.png'))).status).toBe(404);
  });

  it('serve_whenTheReaderCancels_doesNotFail', async () => {
    const directory: string = mkdtempSync(join(tmpdir(), 'media-protocol-'));
    writeFileSync(join(directory, 'large.png'), new Uint8Array(1024 * 1024));

    const response: Response = await fetchMedia(join(directory, 'large.png'));
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
    await reader?.read();

    await expect(reader?.cancel()).resolves.toBeUndefined();
  });
});
