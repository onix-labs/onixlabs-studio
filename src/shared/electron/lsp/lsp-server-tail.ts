/**
 * How many lines of a server's recent output are kept. Enough to hold a .NET stack trace's head and
 * the shutdown line that follows it; small enough that a chatty server costs nothing to remember.
 */
const TAIL_LINES: number = 40;

/**
 * The longest a one-line summary of the exit reason is allowed to be.
 */
const SUMMARY_LENGTH: number = 240;

/**
 * The `window/logMessage` types that count as the server reporting trouble: 1 is Error, 2 is Warning.
 */
const TROUBLE_LOG_TYPES: ReadonlySet<number> = new Set<number>([1, 2]);

/**
 * Remembers the last few things a language server said about itself — its stderr and the errors and
 * warnings it logged over `window/logMessage` — so an exit can be explained.
 *
 * Roslyn, on a protocol violation, logs the exception, logs "Error occurred processing queue", and
 * exits with code 0. Without this tail that exit is indistinguishable from a deliberate stop; thirty-
 * five of them went unexplained in one week because stderr was drained to nowhere and the log messages
 * went only to the renderer's Output panel.
 */
export class LspServerTail {
  /**
   * Holds the retained lines, oldest first.
   */
  private readonly lines: string[] = [];

  /**
   * Holds the last error-level log message the server sent, which is the best single explanation of
   * an exit when there is one.
   */
  private lastError: string | null = null;

  /**
   * Holds the partial last line of stderr, until its newline arrives.
   */
  private partial: string = '';

  /**
   * Records a chunk of the server's stderr.
   * @param chunk The chunk, as text.
   */
  public stderr(chunk: string): void {
    const text: string = this.partial + chunk;
    const parts: string[] = text.split(/\r?\n/);
    this.partial = parts.pop() ?? '';
    for (const line of parts) {
      this.push(`stderr: ${line}`);
    }
  }

  /**
   * Records a `window/logMessage` from the server, when it is a warning or an error. Information and
   * log chatter is left out: during a solution load it runs to thousands of lines.
   * @param params The notification parameters, untrusted.
   */
  public logMessage(params: unknown): void {
    const message: { type?: unknown; message?: unknown } | null =
      (params as { type?: unknown; message?: unknown } | null) ?? null;
    if (
      message === null ||
      typeof message.type !== 'number' ||
      !TROUBLE_LOG_TYPES.has(message.type) ||
      typeof message.message !== 'string'
    ) {
      return;
    }
    const first: string = firstLine(message.message);
    if (first.length === 0) {
      return;
    }
    if (message.type === 1) {
      this.lastError = first;
    }
    this.push(`${message.type === 1 ? 'error' : 'warning'}: ${first}`);
  }

  /**
   * Gets the retained lines, oldest first, the unfinished stderr line included.
   * @returns Returns the lines; empty when the server said nothing.
   */
  public recent(): readonly string[] {
    return this.partial.length === 0 ? [...this.lines] : [...this.lines, `stderr: ${this.partial}`];
  }

  /**
   * Summarises why the server stopped, in one line: its last logged error, else its last line of
   * stderr.
   * @returns Returns the summary, or null when the server gave no account of itself.
   */
  public summary(): string | null {
    const candidate: string | null =
      this.lastError ??
      this.recent()
        .filter((line: string): boolean => line.startsWith('stderr: '))
        .map((line: string): string => line.slice('stderr: '.length))
        .filter((line: string): boolean => line.trim().length > 0)
        .at(-1) ??
      null;
    if (candidate === null) {
      return null;
    }
    const trimmed: string = candidate.trim();
    return trimmed.length > SUMMARY_LENGTH ? `${trimmed.slice(0, SUMMARY_LENGTH - 1)}…` : trimmed;
  }

  /**
   * Appends a line, dropping the oldest once the tail is full.
   * @param line The line.
   */
  private push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > TAIL_LINES) {
      this.lines.shift();
    }
  }
}

/**
 * Takes the first line of a message: a .NET exception message followed by its stack trace is the
 * first line alone.
 * @param message The message.
 * @returns Returns its first non-empty line, trimmed.
 */
function firstLine(message: string): string {
  return (
    message
      .split(/\r?\n/)
      .map((line: string): string => line.trim())
      .find((line: string): boolean => line.length > 0) ?? ''
  );
}
