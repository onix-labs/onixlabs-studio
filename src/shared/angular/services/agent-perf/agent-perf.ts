import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * How often, in milliseconds, the aggregated transcript-performance counters are summarised into one
 * log record. One record per second keeps the audit readable while still resolving typing bursts and
 * streaming generations.
 */
const SUMMARY_INTERVAL_MS: number = 1000;

/**
 * The threshold, in milliseconds, above which a main-thread task is counted as a jank-inducing "long
 * task" (the browser's own long-task cutoff). A frame budget is ~16ms, so a task past 50ms has dropped
 * several frames.
 */
const LONG_TASK_MS: number = 50;

/**
 * Diagnostic instrumentation for the agent transcript's hot path (GitHub #408 — typing lag in long
 * conversations, worst in Mission Control). It aggregates three cheap counters — how often and how long
 * the transcript's {@link rows} computed rebuilds, how often the stream buffer flushes into the
 * transcript, and how many long tasks stall the main thread — plus how many transcript views are
 * mounted at once (the Mission Control amplifier), and emits a one-line summary to the log audit once a
 * second while anything is happening.
 *
 * It is deliberately measurement-only and near-free: the hot-path calls just increment plain fields and
 * take a `performance.now()` delta; the log record (and the summary timer and long-task observer) only
 * run inside Studio, where {@link Log} forwards to the audit. Read the numbers back in the System
 * Monitor by filtering the source `perf.agent-transcript`.
 */
@Service()
export class AgentPerf {
  /**
   * Holds the structured logger the per-second summary is emitted through.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds a value indicating whether instrumentation is active — only inside Studio (where the bridge,
   * and therefore the log audit, exists). Outside it every hook is a cheap no-op counter with no output.
   */
  private readonly enabled: boolean = window.bridge !== undefined;

  /**
   * Holds the number of transcript {@link rows} rebuilds in the current summary window.
   */
  private rebuilds: number = 0;

  /**
   * Holds the total time, in milliseconds, spent rebuilding transcript rows in the current window.
   */
  private rebuildMsTotal: number = 0;

  /**
   * Holds the longest single transcript-rows rebuild, in milliseconds, in the current window.
   */
  private rebuildMsMax: number = 0;

  /**
   * Holds the transcript item count observed at the most recent rebuild (the O(total) input size).
   */
  private lastItems: number = 0;

  /**
   * Holds the built top-level row count observed at the most recent rebuild.
   */
  private lastRows: number = 0;

  /**
   * Holds the number of stream-buffer flushes into the transcript in the current window (each one
   * mutates the items array and drives a rebuild).
   */
  private flushes: number = 0;

  /**
   * Holds the number of main-thread long tasks observed in the current window.
   */
  private longTasks: number = 0;

  /**
   * Holds the longest single long task, in milliseconds, in the current window.
   */
  private longTaskMsMax: number = 0;

  /**
   * Holds how many transcript views are currently mounted (the Mission Control mount multiplier).
   */
  private liveTranscripts: number = 0;

  /**
   * Holds the number of composer keystrokes handled in the current summary window.
   */
  private keystrokes: number = 0;

  /**
   * Holds the total synchronous time, in milliseconds, spent in the composer's input handler in the
   * current window — everything the browser does before it can return to the user.
   */
  private keystrokeMsTotal: number = 0;

  /**
   * Holds the slowest single keystroke, in milliseconds, in the current window.
   */
  private keystrokeMsMax: number = 0;

  /**
   * Holds the total time, in milliseconds, spent inside the text area's auto-grow in the current
   * window. Broken out from the keystroke total because auto-grow reads `scrollHeight` immediately
   * after writing a style, which forces the browser to lay out the *whole document* synchronously —
   * the cost therefore scales with everything mounted, which is what Mission Control multiplies.
   */
  private growMsTotal: number = 0;

  /**
   * Holds the slowest single auto-grow, in milliseconds, in the current window.
   */
  private growMsMax: number = 0;

  /**
   * Initialises the probe, starting the long-task observer and the per-second summary timer inside
   * Studio only. Outside it, nothing is scheduled and the counters are never read.
   */
  public constructor() {
    if (!this.enabled) {
      return;
    }
    this.observeLongTasks();
    setInterval((): void => this.summarise(), SUMMARY_INTERVAL_MS);
  }

  /**
   * Records one transcript-rows rebuild: its duration and the item/row sizes it processed.
   * @param durationMs How long the rebuild took, in milliseconds.
   * @param itemCount The number of transcript items the rebuild processed.
   * @param rowCount The number of top-level rows the rebuild produced.
   */
  public rowsBuilt(durationMs: number, itemCount: number, rowCount: number): void {
    this.rebuilds += 1;
    this.rebuildMsTotal += durationMs;
    this.rebuildMsMax = Math.max(this.rebuildMsMax, durationMs);
    this.lastItems = itemCount;
    this.lastRows = rowCount;
  }

  /**
   * Records one stream-buffer flush into the transcript.
   */
  public streamFlushed(): void {
    this.flushes += 1;
  }

  /**
   * Records one composer keystroke: the whole synchronous cost of handling it, and how much of that
   * was the text area's auto-grow.
   *
   * These are separated because they fail differently. A large `growMs` means the forced document
   * layout is the bottleneck and scales with how much is mounted; a large gap between the two means
   * the cost is in the handler's own work instead.
   * @param totalMs The whole synchronous handler cost, in milliseconds.
   * @param growMs How much of it was auto-grow, in milliseconds.
   */
  public keystroke(totalMs: number, growMs: number): void {
    this.keystrokes += 1;
    this.keystrokeMsTotal += totalMs;
    this.keystrokeMsMax = Math.max(this.keystrokeMsMax, totalMs);
    this.growMsTotal += growMs;
    this.growMsMax = Math.max(this.growMsMax, growMs);
  }

  /**
   * Records that a transcript view has mounted.
   */
  public transcriptMounted(): void {
    this.liveTranscripts += 1;
  }

  /**
   * Records that a transcript view has unmounted.
   */
  public transcriptUnmounted(): void {
    this.liveTranscripts = Math.max(0, this.liveTranscripts - 1);
  }

  /**
   * Emits the current window's aggregated counters as one log record (only when something happened) and
   * resets them for the next window.
   */
  private summarise(): void {
    if (
      this.rebuilds === 0 &&
      this.flushes === 0 &&
      this.longTasks === 0 &&
      this.keystrokes === 0
    ) {
      return;
    }
    const avgRebuildMs: number = this.rebuilds > 0 ? this.rebuildMsTotal / this.rebuilds : 0;
    const avgKeystrokeMs: number =
      this.keystrokes > 0 ? this.keystrokeMsTotal / this.keystrokes : 0;
    const avgGrowMs: number = this.keystrokes > 0 ? this.growMsTotal / this.keystrokes : 0;
    this.log.debug(
      'perf.agent-transcript',
      'transcript perf (last 1s)',
      `rowsRebuilds/s=${this.rebuilds}`,
      `avgRebuildMs=${avgRebuildMs.toFixed(2)}`,
      `maxRebuildMs=${this.rebuildMsMax.toFixed(2)}`,
      `items=${this.lastItems}`,
      `rows=${this.lastRows}`,
      `streamFlushes/s=${this.flushes}`,
      `keystrokes/s=${this.keystrokes}`,
      `avgKeystrokeMs=${avgKeystrokeMs.toFixed(2)}`,
      `maxKeystrokeMs=${this.keystrokeMsMax.toFixed(2)}`,
      `avgGrowMs=${avgGrowMs.toFixed(2)}`,
      `maxGrowMs=${this.growMsMax.toFixed(2)}`,
      `longTasks=${this.longTasks}`,
      `maxLongTaskMs=${this.longTaskMsMax.toFixed(0)}`,
      `liveTranscripts=${this.liveTranscripts}`,
    );
    this.rebuilds = 0;
    this.rebuildMsTotal = 0;
    this.rebuildMsMax = 0;
    this.flushes = 0;
    this.longTasks = 0;
    this.longTaskMsMax = 0;
    this.keystrokes = 0;
    this.keystrokeMsTotal = 0;
    this.keystrokeMsMax = 0;
    this.growMsTotal = 0;
    this.growMsMax = 0;
  }

  /**
   * Starts observing main-thread long tasks, counting each and tracking the worst in the current
   * window. Silently skips when the runtime does not support the `longtask` entry type.
   */
  private observeLongTasks(): void {
    if (typeof PerformanceObserver === 'undefined') {
      return;
    }
    try {
      const observer: PerformanceObserver = new PerformanceObserver(
        (list: PerformanceObserverEntryList): void => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= LONG_TASK_MS) {
              this.longTasks += 1;
              this.longTaskMsMax = Math.max(this.longTaskMsMax, entry.duration);
            }
          }
        },
      );
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // The `longtask` entry type is unsupported here; long-task counts stay zero.
    }
  }
}
