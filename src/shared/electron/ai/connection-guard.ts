// Pure (Electron/Node-free) validation of connection data that arrives from the renderer. The main
// process builds providers — including endpoints and headers — from these connections, so an untrusted
// value is narrowed to the fields the providers and the run path read before it is trusted.

import type { ClaudeExecutableChoice, ClaudeExecutableMode } from '@shared/api/ai-types';
import { DEFAULT_CLAUDE_EXECUTABLE } from '@shared/api/ai-types';
import type { AiConnection } from '@shared/api/ai-types';
import { logger } from '../logger';

/**
 * The recognised Claude CLI modes; an untrusted value outside this set falls back to the bundled CLI.
 */
const CLAUDE_EXECUTABLE_MODES: readonly ClaudeExecutableMode[] = ['bundled', 'system', 'custom'];

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
 * value yields an empty list (from which no providers are built).
 * @param value The untrusted value.
 * @returns Returns the accepted connections.
 */
export function sanitizeConnections(value: unknown): readonly AiConnection[] {
  if (!Array.isArray(value)) {
    logger.warn('connection-guard', 'Connections payload was not an array; accepting none');
    return [];
  }
  const accepted: readonly AiConnection[] = value.filter((entry: unknown): entry is AiConnection =>
    isConnection(entry),
  );
  if (accepted.length < value.length) {
    logger.warn(
      'connection-guard',
      `Dropped ${value.length - accepted.length} malformed connection(s) of ${value.length}`,
    );
  }
  return accepted;
}

/**
 * Coerces an untrusted value from the renderer into a Claude CLI choice, defaulting to the bundled CLI
 * when the value is absent or malformed. An unknown mode falls back to bundled; the custom path is kept
 * only as a string.
 * @param value The untrusted value.
 * @returns Returns a well-formed choice.
 */
export function sanitizeClaudeExecutable(value: unknown): ClaudeExecutableChoice {
  if (typeof value !== 'object' || value === null) {
    logger.debug('connection-guard', 'Claude executable choice absent/malformed; using bundled');
    return DEFAULT_CLAUDE_EXECUTABLE;
  }
  const candidate: Record<string, unknown> = value as Record<string, unknown>;
  const known: boolean = CLAUDE_EXECUTABLE_MODES.includes(
    candidate['mode'] as ClaudeExecutableMode,
  );
  if (!known) {
    logger.warn(
      'connection-guard',
      `Unknown Claude executable mode '${String(candidate['mode'])}'; falling back to bundled`,
    );
  }
  const mode: ClaudeExecutableMode = known
    ? (candidate['mode'] as ClaudeExecutableMode)
    : 'bundled';
  const path: string = typeof candidate['path'] === 'string' ? candidate['path'] : '';
  return { mode, path };
}
