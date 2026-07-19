import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A coarse indication of why an executed mutating/exec action was allowed, computed at the execution
 * point from the run's settings (#311): the user's per-tool policy allowed it (`policy`), the run's
 * permission posture auto-allowed it (`posture`), or it ran through the ordinary path — an interactive
 * grant, a remembered/session rule, or a command the CLI classifier deemed safe (`gated-or-auto`).
 * The last bucket is deliberately coarse: auditing at execution (so classifier-auto-run commands are
 * captured, not just gated ones) means the exact grant path is no longer distinguishable.
 */
export type AuditGrantSource = 'policy' | 'posture' | 'gated-or-auto';

/**
 * A single audit record: one granted mutating/exec agent action.
 */
export interface AuditEntry {
  /**
   * The moment the grant was recorded, as an ISO-8601 timestamp. Stamped by the caller so the log
   * itself stays deterministic (and unit-testable).
   */
  readonly at: string;

  /**
   * The tool's display name (the name the permission prompt showed).
   */
  readonly tool: string;

  /**
   * A one-line summary of what the action targeted (path/command), from `summarizeToolInput`.
   */
  readonly target: string;

  /**
   * The run's workspace root, or null when none was open.
   */
  readonly workspaceRoot: string | null;

  /**
   * How the action was allowed.
   */
  readonly source: AuditGrantSource;
}

/**
 * The append-only file (under userData) the audit records live in, one JSON object per line (JSONL),
 * so appends are cheap and rotation is line-oriented.
 */
const LOG_FILE: string = 'agent-audit-log.jsonl';

/**
 * The size past which the log is rotated on the next write, and the amount kept when it is. Rotation
 * keeps roughly the most recent {@link KEEP_BYTES} of whole lines and drops the older prefix, so the
 * log records recent history without growing unbounded.
 */
const MAX_BYTES: number = 1_000_000;
const KEEP_BYTES: number = 500_000;

/**
 * Records granted agent actions to an append-only log for after-the-fact review (#308). Follows the
 * store idiom of {@link PermissionRuleStore}: every operation is best-effort, so a corrupt, full, or
 * unwritable log can never crash a run — it simply drops the record. The log directory is injected so
 * the class carries no Electron dependency and is unit-testable against a temp directory.
 *
 * Only *granted* mutating/exec actions are logged; read-only auto-allowed tools and denials are
 * deliberately excluded (the former are noise, the latter out of scope for this phase).
 */
export class AgentAuditLog {
  /**
   * Creates the audit log.
   * @param dir The directory the log file lives in (typically userData).
   */
  public constructor(private readonly dir: string) {}

  /**
   * Appends one granted-action record, rotating the log first when it would exceed the size cap.
   * @param entry The record to append.
   */
  public record(entry: AuditEntry): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const line: string = `${JSON.stringify(entry)}\n`;
      this.rotateIfNeeded(line.length);
      appendFileSync(this.file(), line, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Best-effort: a full disk or unwritable path must never break the run — the record is dropped.
    }
  }

  /**
   * Rotates the log when appending would push it past {@link MAX_BYTES}, keeping the most recent whole
   * lines within {@link KEEP_BYTES}. A missing or unreadable file simply means nothing to rotate.
   * @param incomingBytes The size of the record about to be appended.
   */
  private rotateIfNeeded(incomingBytes: number): void {
    try {
      const size: number = statSync(this.file()).size;
      if (size + incomingBytes <= MAX_BYTES) {
        return;
      }
      const kept: string = tailWholeLines(readFileSync(this.file(), 'utf8'), KEEP_BYTES);
      writeFileSync(this.file(), kept, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // No file yet (nothing to rotate) or it is unreadable — the append below starts fresh.
    }
  }

  /**
   * Gets the log file path.
   * @returns Returns the absolute file path.
   */
  private file(): string {
    return join(this.dir, LOG_FILE);
  }
}

/**
 * Returns the tail of a JSONL string bounded to at most `keepBytes`, cut at a line boundary so no
 * partial record survives: the first (possibly truncated) line in the kept window is dropped.
 * @param content The full log content.
 * @param keepBytes The most bytes to keep.
 * @returns Returns the kept tail, ending in a newline, or an empty string when a boundary is unclear.
 */
export function tailWholeLines(content: string, keepBytes: number): string {
  if (content.length <= keepBytes) {
    return content;
  }
  const start: number = content.length - keepBytes;
  const nextLine: number = content.indexOf('\n', start);
  return nextLine === -1 ? '' : content.slice(nextLine + 1);
}
