// Pure (Electron/Node-free) validation of connection data that arrives from the renderer. The main
// process builds providers — including endpoints and headers — from these connections, so an untrusted
// value is narrowed to the fields the providers and the run path read before it is trusted.

import type { AiConnection } from '@shared/api/ai-types';

/**
 * Determines whether a value is a well-formed connection (it carries the fields the providers and the
 * run path read: a string id, kind, and auth, a models array, and a string default model id).
 * @param value The value to test.
 * @returns Returns true when the value is a connection.
 */
export function isConnection(value: unknown): value is AiConnection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    'auth' in value &&
    typeof value.auth === 'string' &&
    'models' in value &&
    Array.isArray(value.models) &&
    'defaultModelId' in value &&
    typeof value.defaultModelId === 'string'
  );
}

/**
 * Coerces an untrusted value from the renderer into a list of well-formed connections, dropping any
 * entry that does not carry the fields the providers are built from. A non-array or fully-malformed
 * value yields an empty list (which makes the caller fall back to the built-in seeds).
 * @param value The untrusted value.
 * @returns Returns the accepted connections.
 */
export function sanitizeConnections(value: unknown): readonly AiConnection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry: unknown): entry is AiConnection => isConnection(entry));
}
