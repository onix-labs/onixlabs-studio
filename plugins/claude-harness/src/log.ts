// Diagnostics from the harness process.
//
// ⚠️ **stderr, never stdout.** stdout carries the protocol: one JSON message per line, and a stray
// diagnostic on it is a line Studio refuses as malformed. Studio drains stderr into its own log, so a
// note written here lands in `studio.log` attributed to this plugin — which is the only way anything
// in here is debuggable at all, the process being one the user never sees.
//
// 🔑 Draining matters in the other direction too: a pipe with no reader eventually fills and stalls
// the writer, so a harness that logs to an undrained stderr deadlocks itself. Studio reads it for
// exactly that reason.

/**
 * Writes one diagnostic line to stderr.
 * @param message The note to record.
 */
export function note(message: string): void {
  process.stderr.write(`${message}\n`);
}
