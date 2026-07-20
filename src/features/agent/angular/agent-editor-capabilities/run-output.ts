// Pure parsing for the run-active-document capability, split out so the sentinel/exit-code logic can
// be unit-tested without a terminal. The run terminal is a persistent shell, so a run command is
// followed by a `printf` sentinel that prints the exit status; this module isolates the program's
// output and exit code from the surrounding terminal buffer using that sentinel.

/**
 * The outcome of parsing a run terminal's buffer for a single run.
 */
export interface RunOutputParse {
  /**
   * Gets a value indicating whether the completion sentinel was found (the run finished).
   */
  readonly found: boolean;

  /**
   * Gets the parsed exit code, or null when the sentinel was not found.
   */
  readonly exitCode: number | null;

  /**
   * Gets the captured program output: the lines between the echoed command and the sentinel, trimmed
   * and capped to the most recent `maxLines`.
   */
  readonly output: string;
}

/**
 * Parses a run's output and exit code from a terminal buffer. The run command is sent with a trailing
 * `printf '\n<prefix>%s__\n' "$?"` sentinel, so the buffer holds:
 *  - the echoed command line, which carries the literal `<prefix>%s__` (a `%s`, never digits); and
 *  - the printed sentinel line, `<prefix><exit-code>__` (always digits).
 * The output is everything between them. Isolating by these unique markers keeps prior buffer content
 * and the plumbing lines out of the result. Matching the digit sentinel distinguishes the printed line
 * from the echoed command, so the echo is never mistaken for completion.
 * @param fullText The terminal buffer text.
 * @param markerPrefix The unique sentinel prefix for this run (for example, `__STUDIO_RUN_3_`).
 * @param maxLines The maximum number of output lines to keep (most recent).
 * @returns Returns the {@link RunOutputParse}.
 */
export function parseRunOutput(
  fullText: string,
  markerPrefix: string,
  maxLines: number,
): RunOutputParse {
  const lines: string[] = fullText.split(/\r?\n/);
  const echoToken: string = `${markerPrefix}%s__`;
  const sentinel: RegExp = new RegExp(`${escapeRegExp(markerPrefix)}(-?\\d+)__`);
  const echoIndex: number = lines.findIndex((line: string): boolean => line.includes(echoToken));
  let endIndex: number = -1;
  let exitCode: number | null = null;
  for (let index: number = Math.max(0, echoIndex + 1); index < lines.length; index += 1) {
    const match: RegExpExecArray | null = sentinel.exec(lines[index]);
    if (match !== null) {
      exitCode = Number.parseInt(match[1], 10);
      endIndex = index;
      break;
    }
  }
  const start: number = echoIndex === -1 ? 0 : echoIndex + 1;
  const end: number = endIndex === -1 ? lines.length : endIndex;
  const output: string = lines
    .slice(start, Math.max(start, end))
    .join('\n')
    .replace(/^\s+|\s+$/g, '')
    .split('\n')
    .slice(-maxLines)
    .join('\n');
  return { found: endIndex !== -1, exitCode, output };
}

/**
 * Escapes a string for literal use inside a regular expression.
 * @param value The string to escape.
 * @returns Returns the escaped string.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
