import { DestroyRef, inject, Service } from '@angular/core';
import {
  LIST_LOG_SESSIONS,
  QUERY_LOGS,
  READ_SYSTEM_METRICS,
  SET_LOG_LEVEL,
  type AiBridgeScope,
} from '@shared/api/ai-types';
import {
  LOG_LEVEL_SETTINGS,
  LogLevelSetting,
  LogRecord,
  LogSession,
  SEVERITIES,
  Severity,
} from '@shared/api/log-channels';
import { MetricsSample, METRICS_HISTORY } from '@shared/api/system-monitor-channels';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';

/**
 * The most records one query may return. The main side clamps too; this is the renderer's own bound,
 * since it is the side that holds the records.
 */
const MAX_RECORDS: number = 300;

/**
 * How many records a query reads from the audit before the time window is applied. The audit answers
 * newest-last and knows nothing of time, so the window is cut from a generous slice of it.
 */
const SCAN_RECORDS: number = 20_000;

/**
 * The answer to a request the System Monitor cannot serve: the run is not the monitor's.
 */
interface Unavailable {
  readonly available: false;
}

/**
 * One reading's low, average, high and latest over the sampled window.
 */
export interface MetricStats {
  readonly latest: number;
  readonly low: number;
  readonly average: number;
  readonly high: number;
}

/**
 * Summarises a series of readings.
 * @param values The readings, oldest first.
 * @returns Returns the summary, or null when there are none.
 */
export function statsOf(values: readonly number[]): MetricStats | null {
  if (values.length === 0) {
    return null;
  }
  const round: (value: number) => number = (value: number): number => Math.round(value * 10) / 10;
  return {
    latest: round(values[values.length - 1]),
    low: round(Math.min(...values)),
    average: round(
      values.reduce((sum: number, value: number): number => sum + value, 0) / values.length,
    ),
    high: round(Math.max(...values)),
  };
}

/**
 * Narrows records to a time window, both ends inclusive and either optional.
 * @param records The records.
 * @param since The earliest time, as ISO-8601, if any.
 * @param until The latest time, as ISO-8601, if any.
 * @returns Returns the records inside the window, or an error when a bound is not a time.
 */
export function withinWindow(
  records: readonly LogRecord[],
  since: string | undefined,
  until: string | undefined,
): readonly LogRecord[] | string {
  const from: number = since === undefined ? -Infinity : Date.parse(since);
  const to: number = until === undefined ? Infinity : Date.parse(until);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return 'The time window must be ISO-8601 times, such as 2026-10-15T13:00:00Z.';
  }
  return records.filter((record: LogRecord): boolean => {
    const at: number = Date.parse(record.timestamp);
    return at >= from && at <= to;
  });
}

/**
 * The System Monitor agent's capabilities (#966): the log audit and the resource readings, read for
 * the model through the run's bridge, and the log level changed through the setting the user changes.
 *
 * Provided by the System Monitor view, so the capabilities exist only while it is open and are
 * released with it. Each answers only a run on the `monitor` surface: another view's agent asking for
 * the logs gets nothing, which keeps the boundary in the place the tools were offered.
 *
 * It keeps its own rolling window of readings rather than borrowing the view's sparklines, so what the
 * agent reads does not depend on how the view happens to draw them.
 */
@Service()
export class SystemMonitorAgentCapabilities {
  /**
   * Holds the agent runtime the capabilities are registered with.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the logging client the audit is read through.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings store, which owns the log level.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the readings sampled while the view was open, oldest first.
   */
  private samples: readonly MetricsSample[] = [];

  /**
   * Registers the capabilities and the reading buffer, and releases both with the view.
   */
  public constructor() {
    const metrics: SystemMonitorMetrics = inject(SystemMonitorMetrics);
    const releases: readonly (() => void)[] = [
      metrics.onSample((sample: MetricsSample): void => {
        this.samples = [...this.samples, sample].slice(-METRICS_HISTORY);
      }),
      this.runtime.registerCapability(
        LIST_LOG_SESSIONS,
        (_input: unknown, scope?: AiBridgeScope) =>
          this.mine(scope) ? this.listSessions() : unavailable(),
      ),
      this.runtime.registerCapability(QUERY_LOGS, (input: unknown, scope?: AiBridgeScope) =>
        this.mine(scope) ? this.query(input) : unavailable(),
      ),
      this.runtime.registerCapability(
        READ_SYSTEM_METRICS,
        (_input: unknown, scope?: AiBridgeScope) =>
          this.mine(scope) ? this.readMetrics() : unavailable(),
      ),
      this.runtime.registerCapability(SET_LOG_LEVEL, (input: unknown, scope?: AiBridgeScope) =>
        this.mine(scope) ? this.setLevel(input) : unavailable(),
      ),
    ];
    inject(DestroyRef).onDestroy((): void => {
      for (const release of releases) {
        release();
      }
    });
  }

  /**
   * Determines whether a request comes from the System Monitor's own agent.
   * @param scope The run's scope, as the bridge reports it.
   * @returns Returns true for a run on the `monitor` surface.
   */
  private mine(scope: AiBridgeScope | undefined): boolean {
    return scope?.surface === 'monitor';
  }

  /**
   * Lists the sessions, newest first.
   * @returns Returns the sessions.
   */
  private async listSessions(): Promise<{ available: true; sessions: readonly LogSession[] }> {
    return { available: true, sessions: await this.log.sessions() };
  }

  /**
   * Reads records, newest first, bounded.
   * @param input The query the model sent.
   * @returns Returns the records, or why there are none.
   */
  private async query(input: unknown): Promise<
    | { available: true; error: string }
    | {
        available: true;
        session: string;
        records: readonly LogRecord[];
        more: boolean;
      }
  > {
    const request: Record<string, unknown> =
      input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const sessions: readonly LogSession[] = await this.log.sessions();
    const named: string | undefined =
      typeof request['session'] === 'string' && request['session'].length > 0
        ? request['session']
        : undefined;
    const session: LogSession | undefined =
      named === undefined
        ? sessions.find((candidate: LogSession): boolean => candidate.current)
        : sessions.find((candidate: LogSession): boolean => candidate.id === named);
    if (session === undefined) {
      return {
        available: true,
        error:
          named === undefined
            ? 'There is no current log session.'
            : `There is no log session "${named}". List the sessions to see which are kept.`,
      };
    }
    const severities: Severity[] = Array.isArray(request['severities'])
      ? request['severities'].filter((value: unknown): value is Severity =>
          SEVERITIES.includes(value as Severity),
        )
      : [];
    const text: string | undefined =
      typeof request['text'] === 'string' && request['text'].trim().length > 0
        ? request['text'].trim()
        : undefined;
    const limit: number =
      typeof request['limit'] === 'number' && Number.isFinite(request['limit'])
        ? Math.min(MAX_RECORDS, Math.max(1, Math.floor(request['limit'])))
        : 100;
    const read: readonly LogRecord[] = await this.log.query({
      sessionId: session.id,
      ...(severities.length === 0 ? {} : { severities }),
      ...(text === undefined ? {} : { text }),
      limit: SCAN_RECORDS,
    });
    const windowed: readonly LogRecord[] | string = withinWindow(
      read,
      typeof request['since'] === 'string' ? request['since'] : undefined,
      typeof request['until'] === 'string' ? request['until'] : undefined,
    );
    if (typeof windowed === 'string') {
      return { available: true, error: windowed };
    }
    // Newest first, which is what a question about "what just happened" wants first.
    const newest: readonly LogRecord[] = [...windowed].reverse();
    return {
      available: true,
      session: session.id,
      records: newest.slice(0, limit),
      more: newest.length > limit,
    };
  }

  /**
   * Summarises the readings sampled while the view has been open.
   * @returns Returns the summary.
   */
  private readMetrics(): { available: true; summary: Record<string, unknown> } {
    const samples: readonly MetricsSample[] = this.samples;
    if (samples.length === 0) {
      return {
        available: true,
        summary: { note: 'No readings yet: they are sampled while the System Monitor is showing.' },
      };
    }
    const latest: MetricsSample = samples[samples.length - 1];
    const series: (read: (sample: MetricsSample) => number | undefined) => MetricStats | null = (
      read: (sample: MetricsSample) => number | undefined,
    ): MetricStats | null =>
      statsOf(
        samples
          .map(read)
          .filter((value: number | undefined): value is number => value !== undefined),
      );
    return {
      available: true,
      summary: {
        window: {
          from: samples[0].timestamp,
          to: latest.timestamp,
          samples: samples.length,
        },
        cpuPercent: series((sample: MetricsSample): number => sample.cpu),
        memoryPercent: series((sample: MetricsSample): number => sample.memory.percent),
        memoryTotalBytes: latest.memory.totalBytes,
        studioCpuPercent: series(
          (sample: MetricsSample): number | undefined => sample.app?.cpuPercent,
        ),
        studioMemoryPercent: series(
          (sample: MetricsSample): number | undefined => sample.app?.memoryPercent,
        ),
        gpuPercent: series((sample: MetricsSample): number | undefined =>
          sample.gpu?.available === true ? sample.gpu.percent : undefined,
        ),
        networkReceivedBytesPerSec: series(
          (sample: MetricsSample): number | undefined => sample.network?.rxBytesPerSec,
        ),
        networkSentBytesPerSec: series(
          (sample: MetricsSample): number | undefined => sample.network?.txBytesPerSec,
        ),
        diskReadBytesPerSec: series(
          (sample: MetricsSample): number | undefined => sample.disk?.readBytesPerSec,
        ),
        diskWriteBytesPerSec: series(
          (sample: MetricsSample): number | undefined => sample.disk?.writeBytesPerSec,
        ),
      },
    };
  }

  /**
   * Changes the log level through its setting, which is what applies it — so Settings shows the change.
   * @param input The request the model sent.
   * @returns Returns the outcome.
   */
  private setLevel(input: unknown): { ok: boolean; error?: string; previous?: string } {
    const level: unknown =
      input !== null && typeof input === 'object'
        ? (input as Record<string, unknown>)['level']
        : null;
    if (!LOG_LEVEL_SETTINGS.includes(level as LogLevelSetting)) {
      return { ok: false, error: `"${String(level)}" is not a log level.` };
    }
    const previous: LogLevelSetting = this.settings.value('application.logLevel')();
    this.settings.set('application.logLevel', level as LogLevelSetting);
    return { ok: true, previous };
  }
}

/**
 * The answer to a run that is not the System Monitor's.
 * @returns Returns the refusal.
 */
function unavailable(): Unavailable {
  return { available: false };
}
