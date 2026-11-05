/**
 * Specifies how a {@link LineSplitter} treats the stream it reads.
 */
export interface LineSplitterOptions {
  /**
   * Receives each complete line, without its newline.
   */
  readonly onLine: (line: string) => void;

  /**
   * Specifies whether to trim each line and skip the ones left empty. Off for a stream where the
   * whitespace is data, such as file paths; a carriage return is then the caller's to remove.
   */
  readonly trim?: boolean;

  /**
   * Specifies the longest unfinished line to hold. Undefined holds any length.
   */
  readonly maxLineLength?: number;

  /**
   * Receives the news that an unfinished line outgrew {@link maxLineLength} and was dropped.
   */
  readonly onOversized?: () => void;
}
