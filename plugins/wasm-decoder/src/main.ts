/**
 * The WebAssembly decoder plugin's entry point: answers the decoder protocol using the module decoder.
 *
 * A module's section table is walked from the start, so the whole file is needed rather than a window.
 */
import { decodeWasm } from './wasm-decoder';
import { CodeListing, PROTOCOL_VERSION, serve } from '../../protocol/listing';

/**
 * The formats this decoder claims.
 */
const FORMATS: readonly string[] = ['wasm'];

serve((request: Record<string, unknown>): unknown => {
  const id: number = typeof request['id'] === 'number' ? request['id'] : 0;
  const op: unknown = request['op'];

  if (op === 'describe') {
    return {
      id,
      ok: true,
      description: { protocol: PROTOCOL_VERSION, formats: FORMATS, requiresWholeFile: true },
    };
  }
  if (op !== 'decode') {
    return { id, ok: false, error: `unknown op '${String(op)}'` };
  }
  if (request['format'] !== 'wasm') {
    return { id, ok: false, error: `unsupported format '${String(request['format'])}'` };
  }
  const encoded: unknown = request['bytes'];
  if (typeof encoded !== 'string') {
    return { id, ok: false, error: 'bytes must be a base64 string' };
  }

  const buffer: Buffer = Buffer.from(encoded, 'base64');
  const bytes: Uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const path: unknown = request['path'];
  const listing: CodeListing = decodeWasm(bytes, typeof path === 'string' ? path : null);
  return { id, ok: true, listing };
});
