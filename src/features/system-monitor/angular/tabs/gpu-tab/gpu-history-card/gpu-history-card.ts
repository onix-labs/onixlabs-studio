import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  EffectCleanupRegisterFn,
  inject,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import {
  GPU_HISTORY_INTERVAL_MS,
  GPU_SAMPLE_INTERVAL_MS,
  GpuHistory,
  GpuHistoryPoint,
  GpuReading,
} from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { SystemMonitorMetrics } from '../../../metrics/system-monitor-metrics';
import { formatPercent } from '../../../readings/format';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one of the history's spans.
 */
interface HistoryRange {
  /**
   * Gets the span's name (`1 hour`).
   */
  readonly label: string;

  /**
   * Gets the span, in milliseconds.
   */
  readonly spanMs: number;
}

/**
 * The history's spans, shortest first.
 */
const RANGES: readonly HistoryRange[] = [
  { label: '1 min', spanMs: 60_000 },
  { label: '5 min', spanMs: 5 * 60_000 },
  { label: '15 min', spanMs: 15 * 60_000 },
  { label: '1 hour', spanMs: 60 * 60_000 },
  { label: '6 hours', spanMs: 6 * 60 * 60_000 },
  { label: '24 hours', spanMs: 24 * 60 * 60_000 },
];

/**
 * One point of the history card's graph: utilisation and the video memory's share, either possibly
 * unread.
 */
interface HistoryValues {
  /**
   * Gets the utilisation, 0–100.
   */
  readonly utilisation?: number;

  /**
   * Gets the video memory's share in use, 0–100.
   */
  readonly memory?: number;
}

/**
 * The longest span drawn from the live readings rather than the background history.
 */
const LIVE_SPAN_MS: number = 5 * 60_000;

/**
 * Represents the GPU view's history card: the GPU's utilisation, and its video memory in use as a share
 * of what there is, over a chosen span from a minute to a day. The minute and five draw from the live
 * readings; longer spans from the history Studio keeps in the background while GPU Monitoring is on,
 * refreshed while the card shows them.
 */
@Component({
  selector: 'app-system-monitor-gpu-history-card',
  imports: [DashboardCard, Button, LineChart],
  templateUrl: './gpu-history-card.html',
  styleUrl: './gpu-history-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuHistoryCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the history's spans.
   */
  protected readonly ranges: readonly HistoryRange[] = RANGES;

  /**
   * Gets how a share is written, on the axis and in the readout.
   */
  protected readonly percent: (value: number) => string = formatPercent;

  /**
   * Holds the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Holds the view's readings, for the GPU's described memory.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the backend client the longer spans are read through.
   */
  private readonly metrics: SystemMonitorMetrics = inject(SystemMonitorMetrics);

  /**
   * Holds the span chosen.
   */
  protected readonly range: WritableSignal<HistoryRange> = signal<HistoryRange>(RANGES[0]);

  /**
   * Holds the background history last read for a longer span, or null before it arrives.
   */
  private readonly history: WritableSignal<GpuHistory | null> = signal<GpuHistory | null>(null);

  /**
   * Gets whether the chosen span draws from the live readings.
   */
  protected readonly live: Signal<boolean> = computed(
    (): boolean => this.range().spanMs <= LIVE_SPAN_MS,
  );

  /**
   * Gets the video memory there is, for the memory's share.
   */
  private readonly total: Signal<number | undefined> = computed(
    (): number | undefined =>
      this.gpu.latest()?.memoryTotalBytes ?? this.readings.info()?.gpus[0]?.memoryBytes,
  );

  /**
   * Gets the time each point stands for.
   */
  protected readonly intervalMs: Signal<number> = computed((): number =>
    this.live() ? GPU_SAMPLE_INTERVAL_MS : (this.history()?.intervalMs ?? GPU_HISTORY_INTERVAL_MS),
  );

  /**
   * Gets the graph's series: utilisation, and the video memory in use as a share of what there is.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => {
      const total: number | undefined = this.total();
      const share: (bytes: number | undefined) => number | undefined = (
        bytes: number | undefined,
      ): number | undefined =>
        bytes === undefined || total === undefined || total <= 0
          ? undefined
          : (bytes / total) * 100;
      const points: readonly HistoryValues[] = this.live()
        ? this.gpu
            .readings()
            .slice(-Math.ceil(this.range().spanMs / GPU_SAMPLE_INTERVAL_MS))
            .map((reading: GpuReading): HistoryValues => ({
              utilisation: reading.utilisationPercent,
              memory: share(reading.memoryUsedBytes),
            }))
        : (this.history()?.points ?? []).map((point: GpuHistoryPoint): HistoryValues => ({
            utilisation: point.utilisationPercent,
            memory: share(point.memoryUsedBytes),
          }));
      const values: (pick: (point: HistoryValues) => number | undefined) => number[] = (
        pick: (point: HistoryValues) => number | undefined,
      ): number[] =>
        points
          .map(pick)
          .filter((value: number | undefined): value is number => value !== undefined);
      const series: ChartSeries[] = [
        {
          label: 'GPU',
          values: values((point: HistoryValues): number | undefined => point.utilisation),
          emphasis: 'primary',
        },
      ];
      const memory: number[] = values((point: HistoryValues): number | undefined => point.memory);
      if (memory.length > 0) {
        series.push({ label: 'VRAM', values: memory, emphasis: 'secondary' });
      }
      return series;
    },
  );

  /**
   * Gets whether there is anything to draw.
   */
  protected readonly empty: Signal<boolean> = computed(
    (): boolean => this.series()[0].values.length === 0,
  );

  /**
   * Creates the card, reading the background history for a longer span when it is chosen and every
   * time the background takes a reading while it stays chosen.
   */
  public constructor() {
    effect((onCleanup: EffectCleanupRegisterFn): void => {
      const range: HistoryRange = this.range();
      if (range.spanMs <= LIVE_SPAN_MS) {
        return;
      }
      untracked((): void => {
        this.history.set(null);
        void this.load(range.spanMs);
      });
      const timer: ReturnType<typeof setInterval> = setInterval(
        (): void => void this.load(range.spanMs),
        GPU_HISTORY_INTERVAL_MS,
      );
      onCleanup((): void => clearInterval(timer));
    });
  }

  /**
   * Shows a span.
   * @param range The span.
   */
  protected select(range: HistoryRange): void {
    this.range.set(range);
  }

  /**
   * Reads the background history over a span.
   * @param spanMs The span, in milliseconds.
   */
  private async load(spanMs: number): Promise<void> {
    const history: GpuHistory | null = await this.metrics.gpuHistory(spanMs);
    if (this.range().spanMs === spanMs) {
      this.history.set(history);
    }
  }
}
