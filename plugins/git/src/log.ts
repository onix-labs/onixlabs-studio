// Diagnostics from the Git plugin's process.
//
// ⚠️ stderr, never stdout: stdout carries the protocol, one JSON message per line, and a stray line on
// it is a response Studio refuses as malformed. Studio drains stderr into its own log, attributed to
// this plugin — and a pipe nobody drains eventually stalls the writer, which is why it is read.

/**
 * Whether verbose diagnostics are written: set `STUDIO_GIT_DEBUG=1` to trace every git invocation.
 */
const VERBOSE: boolean = process.env['STUDIO_GIT_DEBUG'] === '1';

/**
 * Writes one diagnostic line to stderr.
 * @param scope What is reporting.
 * @param message The note.
 * @param error An error to append, when there is one.
 */
export function note(scope: string, message: string, error?: unknown): void {
  const detail: string =
    error === undefined
      ? ''
      : `: ${error instanceof Error ? error.message : (JSON.stringify(error) ?? 'unknown error')}`;
  process.stderr.write(`[${scope}] ${message}${detail}\n`);
}

/**
 * Writes one verbose diagnostic line to stderr, only when tracing is switched on.
 * @param scope What is reporting.
 * @param message The note.
 */
export function debug(scope: string, message: string): void {
  if (VERBOSE) {
    note(scope, message);
  }
}
