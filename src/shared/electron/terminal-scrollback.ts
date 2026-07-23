import { TerminalReplay } from '@shared/api/terminal-channels';

/**
 * Specifies the maximum retained scrollback length per session, in characters. Generously above the
 * renderer's visible scrollback so a replay can refill it, while bounding memory for long-lived
 * chatty sessions.
 */
const MAX_RETAINED_LENGTH: number = 1_000_000;

/**
 * Holds one session's retained output state.
 */
interface ScrollbackRecord {
  /**
   * Holds the retained output, bounded to the most recent span of the stream.
   */
  data: string;

  /**
   * Holds the sequence number of the last appended chunk.
   */
  seq: number;

  /**
   * Holds the exit code the session's process ended with, or null while it runs.
   */
  exitCode: number | null;

  /**
   * Holds the number of the signal that ended the process, or null when it exited on its own.
   */
  signal: number | null;
}

/**
 * Retains each terminal session's recent output in the main process, so the renderer can re-attach a
 * pane to a live (or exited) session and replay what it missed while no pane was mounted. Chunks are
 * numbered as they are appended; a snapshot carries the last sequence number it contains, letting a
 * re-attaching pane discard live chunks that raced the snapshot. Records survive process exit (so an
 * exited session's history and exit code remain replayable) and are removed only on dispose.
 */
export class TerminalScrollback {
  /**
   * Holds the retained records, keyed by terminal identifier.
   */
  private readonly records: Map<string, ScrollbackRecord> = new Map<string, ScrollbackRecord>();

  /**
   * Starts a fresh record for a session, discarding any previous one. Called when a PTY spawns under
   * the identifier, so a re-created session never replays a predecessor's output.
   * @param id The terminal identifier.
   */
  public reset(id: string): void {
    this.records.set(id, { data: '', seq: 0, exitCode: null, signal: null });
  }

  /**
   * Appends an output chunk to a session's record, trimming the retained span from the front once it
   * exceeds the cap. The trim prefers the next line break so a replay rarely begins mid-line (a cut
   * mid-escape-sequence would briefly render artifacts).
   * @param id The terminal identifier.
   * @param chunk The output chunk.
   * @returns Returns the chunk's sequence number in the session's stream.
   */
  public append(id: string, chunk: string): number {
    let record: ScrollbackRecord | undefined = this.records.get(id);
    if (record === undefined) {
      record = { data: '', seq: 0, exitCode: null, signal: null };
      this.records.set(id, record);
    }
    record.data += chunk;
    record.seq += 1;
    if (record.data.length > MAX_RETAINED_LENGTH) {
      const cut: number = record.data.length - MAX_RETAINED_LENGTH;
      const lineBreak: number = record.data.indexOf('\n', cut);
      record.data = record.data.slice(lineBreak === -1 ? cut : lineBreak + 1);
    }
    return record.seq;
  }

  /**
   * Records that a session's process has ended, keeping its output replayable.
   * @param id The terminal identifier.
   * @param exitCode The process exit code.
   * @param signal The number of the signal that ended it, or null when it exited on its own.
   */
  public markExited(id: string, exitCode: number, signal: number | null = null): void {
    const record: ScrollbackRecord | undefined = this.records.get(id);
    if (record !== undefined) {
      record.exitCode = exitCode;
      record.signal = signal;
    }
  }

  /**
   * Reads a session's snapshot for replay. An unknown identifier yields an empty snapshot, which a
   * fresh terminal replays as nothing.
   * @param id The terminal identifier.
   * @returns Returns the snapshot.
   */
  public snapshot(id: string): TerminalReplay {
    const record: ScrollbackRecord | undefined = this.records.get(id);
    return record === undefined
      ? { data: '', seq: 0, exitCode: null, signal: null }
      : { data: record.data, seq: record.seq, exitCode: record.exitCode, signal: record.signal };
  }

  /**
   * Removes a session's record. Called on dispose, when the session is gone for good.
   * @param id The terminal identifier.
   * @returns Returns true when a record existed.
   */
  public delete(id: string): boolean {
    return this.records.delete(id);
  }

  /**
   * Removes every record. Called on application shutdown.
   */
  public clear(): void {
    this.records.clear();
  }
}
