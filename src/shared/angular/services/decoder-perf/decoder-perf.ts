import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * How often, in milliseconds, the aggregated decode counters are summarised into one log record.
 */
const SUMMARY_INTERVAL_MS: number = 1000;

/**
 * The budget, in milliseconds, for one viewport-driven decode — a window of bytes decoded as the user
 * scrolls the binary view.
 *
 * Derived from the view's own behaviour rather than picked: viewport decodes are debounced 120ms
 * (`DISASSEMBLY_DEBOUNCE_MS`) so a request is issued once scrolling settles, and the user waits for
 * the debounce *plus* the decode. Holding the decode to the same 120ms keeps that total near the
 * ~250ms at which a response still reads as immediate, and means the decode is never the dominant
 * cost of a scroll. Every decode is now an IPC round-trip to an out-of-process plugin where it used
 * to be an in-process call (#574), which is exactly the regression this measures.
 */
export const WINDOWED_DECODE_BUDGET_MS: number = 120;

/**
 * The budget, in milliseconds, for one whole-file decode — a metadata format (managed IL) whose tables
 * are spread across the file, so it is handed everything at once.
 *
 * A looser budget than a windowed decode because it is a different interaction: it happens once per
 * edit version rather than once per scroll (the result is cached, so scrolling an assembly costs no
 * further decodes), and it may carry up to 64 MB. One second is the threshold past which a user stops
 * feeling the application is responding to them, which is the right bar for a one-off.
 */
export const WHOLE_FILE_DECODE_BUDGET_MS: number = 1000;

/**
 * Diagnostic instrumentation for decoder round-trips (GitHub #583).
 *
 * Decoding moved out of process when decoders became plugins (#574): what was an in-process call is
 * now IPC to a child process, and the binary view issues one per viewport movement. This measures what
 * that actually costs, aggregating cheap counters into a one-line summary per second — count, average
 * and worst latency, bytes carried, and how many decodes missed their budget — split by the two shapes
 * of request, which fail differently and so are judged against different budgets.
 *
 * It is measurement-only and near-free: the hot path takes a `performance.now()` delta and increments
 * plain fields. The summary timer runs only inside Studio, where {@link Log} forwards to the audit;
 * outside it every hook is a no-op counter with no output. Read the numbers back in the System Monitor
 * by filtering the source `perf.decoder`.
 */
@Service()
export class DecoderPerf {
  /**
   * Holds the structured logger the per-second summary is emitted through.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds a value indicating whether instrumentation is active — only inside Studio, where the bridge,
   * and therefore the log audit, exists.
   */
  private readonly enabled: boolean = window.bridge !== undefined;

  /**
   * Holds the number of viewport-window decodes in the current summary window.
   */
  private windowed: number = 0;

  /**
   * Holds the total time, in milliseconds, spent on viewport-window decodes in the current window.
   */
  private windowedMsTotal: number = 0;

  /**
   * Holds the slowest single viewport-window decode, in milliseconds, in the current window.
   */
  private windowedMsMax: number = 0;

  /**
   * Holds how many viewport-window decodes exceeded {@link WINDOWED_DECODE_BUDGET_MS}.
   */
  private windowedOverBudget: number = 0;

  /**
   * Holds the number of whole-file decodes in the current summary window.
   */
  private wholeFile: number = 0;

  /**
   * Holds the total time, in milliseconds, spent on whole-file decodes in the current window.
   */
  private wholeFileMsTotal: number = 0;

  /**
   * Holds the slowest single whole-file decode, in milliseconds, in the current window.
   */
  private wholeFileMsMax: number = 0;

  /**
   * Holds how many whole-file decodes exceeded {@link WHOLE_FILE_DECODE_BUDGET_MS}.
   */
  private wholeFileOverBudget: number = 0;

  /**
   * Holds the total bytes handed to decoders in the current window — the IPC payload, which is what
   * separates a slow decoder from an expensive transfer.
   */
  private bytesTotal: number = 0;

  /**
   * Holds how many decodes answered with nothing (no decoder installed, or the decoder failed) in the
   * current window. A fast null is not a fast decode, so these are counted apart from the latencies.
   */
  private empty: number = 0;

  /**
   * Holds the format key of the most recent decode, so a summary line says what was being decoded.
   */
  private lastFormat: string = '';

  /**
   * Initialises the probe, starting the per-second summary timer inside Studio only.
   */
  public constructor() {
    if (!this.enabled) {
      return;
    }
    setInterval((): void => this.summarise(), SUMMARY_INTERVAL_MS);
  }

  /**
   * Records one decode round-trip.
   * @param format The canonical format key decoded.
   * @param durationMs How long the round-trip took, in milliseconds.
   * @param byteCount How many bytes were handed to the decoder.
   * @param wholeFile Whether the whole file was sent, rather than a viewport window.
   * @param produced Whether the decode produced a listing.
   */
  public decoded(
    format: string,
    durationMs: number,
    byteCount: number,
    wholeFile: boolean,
    produced: boolean,
  ): void {
    this.lastFormat = format;
    this.bytesTotal += byteCount;
    if (!produced) {
      this.empty += 1;
    }
    if (wholeFile) {
      this.wholeFile += 1;
      this.wholeFileMsTotal += durationMs;
      this.wholeFileMsMax = Math.max(this.wholeFileMsMax, durationMs);
      if (durationMs > WHOLE_FILE_DECODE_BUDGET_MS) {
        this.wholeFileOverBudget += 1;
      }
      return;
    }
    this.windowed += 1;
    this.windowedMsTotal += durationMs;
    this.windowedMsMax = Math.max(this.windowedMsMax, durationMs);
    if (durationMs > WINDOWED_DECODE_BUDGET_MS) {
      this.windowedOverBudget += 1;
    }
  }

  /**
   * Emits the current window's aggregated counters as one log record (only when something happened)
   * and resets them for the next window. A window that missed a budget is logged at warning level, so
   * the audit distinguishes "measured and fine" from "measured and over" without a reader doing the
   * arithmetic.
   */
  private summarise(): void {
    if (this.windowed === 0 && this.wholeFile === 0) {
      return;
    }
    const avgWindowedMs: number = this.windowed > 0 ? this.windowedMsTotal / this.windowed : 0;
    const avgWholeFileMs: number = this.wholeFile > 0 ? this.wholeFileMsTotal / this.wholeFile : 0;
    const overBudget: number = this.windowedOverBudget + this.wholeFileOverBudget;
    const details: readonly string[] = [
      `format=${this.lastFormat}`,
      `windowed/s=${this.windowed}`,
      `avgWindowedMs=${avgWindowedMs.toFixed(2)}`,
      `maxWindowedMs=${this.windowedMsMax.toFixed(2)}`,
      `windowedBudgetMs=${WINDOWED_DECODE_BUDGET_MS}`,
      `windowedOverBudget=${this.windowedOverBudget}`,
      `wholeFile/s=${this.wholeFile}`,
      `avgWholeFileMs=${avgWholeFileMs.toFixed(2)}`,
      `maxWholeFileMs=${this.wholeFileMsMax.toFixed(2)}`,
      `wholeFileBudgetMs=${WHOLE_FILE_DECODE_BUDGET_MS}`,
      `wholeFileOverBudget=${this.wholeFileOverBudget}`,
      `kb=${(this.bytesTotal / 1024).toFixed(1)}`,
      `empty=${this.empty}`,
    ];
    if (overBudget > 0) {
      this.log.warn('perf.decoder', 'decoder perf (last 1s) — over budget', ...details);
    } else {
      this.log.debug('perf.decoder', 'decoder perf (last 1s)', ...details);
    }
    this.windowed = 0;
    this.windowedMsTotal = 0;
    this.windowedMsMax = 0;
    this.windowedOverBudget = 0;
    this.wholeFile = 0;
    this.wholeFileMsTotal = 0;
    this.wholeFileMsMax = 0;
    this.wholeFileOverBudget = 0;
    this.bytesTotal = 0;
    this.empty = 0;
  }
}
