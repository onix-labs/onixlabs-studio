import { mkdtempSync, writeFileSync } from 'node:fs';
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
});
