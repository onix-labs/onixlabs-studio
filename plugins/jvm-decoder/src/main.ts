/**
 * The JVM decoder plugin's entry point: answers the decoder protocol using the class-file decoder.
 *
 * A class file is self-describing and small, so this decodes the whole file each time rather than
 * asking for the whole file up front — `requiresWholeFile` is about decoders that cannot work from a
 * window at all, and a class file the caller is showing is already entirely in the window when the
 * window is the file.
 */
import { decodeClass } from './class-decoder';
import { CodeListing, PROTOCOL_VERSION, serve } from '../../protocol/listing';

/**
 * The formats this decoder claims.
 */
const FORMATS: readonly string[] = ['jvm'];

serve((request: Record<string, unknown>): unknown => {
  const id: number = typeof request['id'] === 'number' ? request['id'] : 0;
  const op: unknown = request['op'];

  if (op === 'describe') {
    return {
      id,
      ok: true,
      description: {
        protocol: PROTOCOL_VERSION,
        formats: FORMATS,
        // A class file is read from its own header outwards, so it must arrive whole.
        requiresWholeFile: true,
      },
    };
  }
  if (op !== 'decode') {
    return { id, ok: false, error: `unknown op '${String(op)}'` };
  }
  if (request['format'] !== 'jvm') {
    return { id, ok: false, error: `unsupported format '${String(request['format'])}'` };
  }
  const encoded: unknown = request['bytes'];
  if (typeof encoded !== 'string') {
    return { id, ok: false, error: 'bytes must be a base64 string' };
  }

  const buffer: Buffer = Buffer.from(encoded, 'base64');
  const bytes: Uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const path: unknown = request['path'];
  const listing: CodeListing = decodeClass(bytes, typeof path === 'string' ? path : null);
  return { id, ok: true, listing };
});
