// Diagnostics from the vcpkg plugin's process.
//
// ⚠️ stderr, never stdout: stdout carries the protocol, one JSON message per line, and a stray line on
// it is a response Studio refuses as malformed. Studio drains stderr into its own log, attributed to
// this plugin.
//
// ⛔ Nothing written here may carry a token, an `Authorization` header or a registry URL with a user in
// it. Studio's log is a file the user may paste into an issue.

/**
 * Writes one diagnostic line to stderr.
 * @param scope What is reporting.
 * @param message The note.
 */
export function note(scope: string, message: string): void {
  process.stderr.write(`[${scope}] ${message}\n`);
}
