// Diagnostics from the engine plugin's process.
//
// ⚠️ stderr, never stdout: stdout carries the protocol, one JSON message per line, and a stray line on
// it is a message Studio refuses as malformed. Studio drains stderr into its own log, attributed to
// this plugin.

/**
 * Whether trace lines are written, for a session being debugged.
 */
const VERBOSE: boolean = process.env['STUDIO_ENGINE_DEBUG'] === '1';

/**
 * Writes a diagnostic line.
 * @param scope What wrote it.
 * @param message What happened.
 * @param error The error behind it, if any.
 */
export function note(scope: string, message: string, error?: unknown): void {
  const detail: string =
    error === undefined
      ? ''
      : `: ${error instanceof Error ? error.message : (JSON.stringify(error) ?? 'unknown error')}`;
  process.stderr.write(`[${scope}] ${message}${detail}\n`);
}

/**
 * Writes a trace line, only when tracing is on.
 * @param scope What wrote it.
 * @param message What happened.
 */
export function trace(scope: string, message: string): void {
  if (VERBOSE) {
    note(scope, message);
  }
}
