import { LineSplitterOptions } from './line-splitter-options';

/**
 * Specifies the longest stdout line, in characters, a plugin client holds while waiting for its
 * newline. Generous, since an honest answer can be large (a repository's whole log, a decoded
 * assembly), but a peer that writes an unbounded message, or never ends a line, must not be able to
 * grow the main process without limit.
 */
export const MAX_LINE_LENGTH: number = 64 * 1024 * 1024;

/**
 * Splits a stream of text into lines.
 *
 * Only ever scans the chunk that just arrived. Appending to one buffer and searching it from the
 * start reads the whole of an unfinished line again for every chunk, which is quadratic: a 64 MB line
 * in pipe-sized chunks stalled the main process for over twenty seconds. Held pieces are joined once,
 * when the newline arrives.
 *
 * {@link LineSplitterOptions.maxLineLength} bounds the unfinished line only. A line that ends inside
 * the chunk that carried it is already in memory, so it is delivered whatever its length. A line
 * that is refused is dropped along with everything up to its newline, so the stream stays in step
 * for the lines after it.
 */
export class LineSplitter {
  /**
   * Holds the pieces of the unfinished line.
   */
  private pieces: string[] = [];

  /**
   * Holds the combined length of {@link pieces}.
   */
  private pendingLength: number = 0;

  /**
   * Holds whether the rest of a refused line is still being skipped.
   */
  private discarding: boolean = false;

  /**
   * Holds a count of resets, so a push can tell that a line's handler reset the splitter under it.
   */
  private resets: number = 0;

  /**
   * Holds how to treat the stream.
   */
  private readonly options: LineSplitterOptions;

  /**
   * Initializes a new instance of the {@link LineSplitter} class.
   * @param options How to treat the stream.
   */
  public constructor(options: LineSplitterOptions) {
    this.options = options;
  }

  /**
   * Reads the next chunk, delivering each line it completes.
   * @param chunk The text received.
   */
  public push(chunk: string): void {
    const resets: number = this.resets;
    let start: number = 0;
    let newline: number = chunk.indexOf('\n');
    if (this.discarding) {
      if (newline === -1) {
        return;
      }
      this.discarding = false;
      start = newline + 1;
      newline = chunk.indexOf('\n', start);
    }
    while (newline !== -1) {
      this.deliver(this.take(chunk.slice(start, newline)));
      if (this.resets !== resets) {
        return;
      }
      start = newline + 1;
      newline = chunk.indexOf('\n', start);
    }
    if (start < chunk.length) {
      this.pieces.push(start === 0 ? chunk : chunk.slice(start));
      this.pendingLength += chunk.length - start;
    }
    const { maxLineLength, onOversized }: LineSplitterOptions = this.options;
    if (maxLineLength !== undefined && this.pendingLength > maxLineLength) {
      this.reset();
      this.discarding = true;
      onOversized?.();
    }
  }

  /**
   * Forgets the unfinished line and any line being skipped, for a stream that has ended or that is
   * starting over: what the last process left half-written is not the start of the next one's first
   * line. Any lines left in a chunk being read are not delivered.
   */
  public reset(): void {
    this.pieces = [];
    this.pendingLength = 0;
    this.discarding = false;
    this.resets += 1;
  }

  /**
   * Completes the unfinished line with its last piece.
   * @param end The text up to the newline.
   * @returns Returns the whole line.
   */
  private take(end: string): string {
    if (this.pieces.length === 0) {
      return end;
    }
    this.pieces.push(end);
    const line: string = this.pieces.join('');
    this.pieces = [];
    this.pendingLength = 0;
    return line;
  }

  /**
   * Hands a line to the caller.
   * @param line The line.
   */
  private deliver(line: string): void {
    if (this.options.trim !== true) {
      this.options.onLine(line);
      return;
    }
    const trimmed: string = line.trim();
    if (trimmed.length > 0) {
      this.options.onLine(trimmed);
    }
  }
}
