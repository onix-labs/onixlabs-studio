import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { GpuEngineKind } from '@shared/api/system-monitor-channels';
import { formatPercent } from '../../../readings/format';
import { GpuEngineHistory, SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { Sparkline } from '../../../sparkline/sparkline';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Each engine kind's glyph.
 */
const ENGINE_ICONS: Readonly<Record<GpuEngineKind, Icon>> = {
  '3d': Icon.MONITOR_ENGINE_3D,
  decode: Icon.MONITOR_ENGINE_DECODE,
  encode: Icon.MONITOR_ENGINE_ENCODE,
  copy: Icon.MONITOR_ENGINE_COPY,
  compute: Icon.MONITOR_ENGINE_COMPUTE,
  other: Icon.MONITOR_GPU,
};

/**
 * Describes one engine's row.
 */
interface EngineRow {
  /**
   * Gets the row's key: the engine's kind and name.
   */
  readonly key: string;

  /**
   * Gets the engine's glyph.
   */
  readonly icon: Icon;

  /**
   * Gets the engine's name.
   */
  readonly label: string;

  /**
   * Gets the engine's activity, formatted in its unit (`2%`, `106/s`).
   */
  readonly value: string;

  /**
   * Gets its recent activity.
   */
  readonly values: readonly number[];

  /**
   * Gets the top of its graph: 100 for a percentage, the busiest moment for a rate.
   */
  readonly max: number;
}

/**
 * Represents the GPU view's engines card: what each of the GPU's engines (3D, video decode and encode,
 * copy, compute) is doing, with its recent activity. A percentage busy where the platform reports one;
 * on macOS with an AMD GPU, which reports none, the commands each engine is given a second.
 */
@Component({
  selector: 'app-system-monitor-gpu-engines-card',
  imports: [DashboardCard, AppIcon, Sparkline],
  templateUrl: './gpu-engines-card.html',
  styleUrl: './gpu-engines-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuEnginesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets whether a reading has arrived.
   */
  protected readonly read: Signal<boolean> = computed((): boolean => this.gpu.latest() !== null);

  /**
   * Gets whether the engines read in commands a second rather than a percentage.
   */
  protected readonly inCommands: Signal<boolean> = computed((): boolean =>
    this.gpu
      .engines()
      .some((history: GpuEngineHistory): boolean => history.engine.unit === 'commands'),
  );

  /**
   * Gets one row per engine.
   */
  protected readonly rows: Signal<readonly EngineRow[]> = computed((): readonly EngineRow[] =>
    this.gpu.engines().map((history: GpuEngineHistory): EngineRow => {
      const percent: boolean = history.engine.unit === 'percent';
      return {
        key: `${history.engine.kind}:${history.engine.label}`,
        icon: ENGINE_ICONS[history.engine.kind],
        label: history.engine.label,
        value: percent
          ? formatPercent(history.engine.value)
          : `${Math.round(history.engine.value).toLocaleString()}/s`,
        values: history.values,
        max: percent ? 100 : Math.max(1, ...history.values),
      };
    }),
  );
}
