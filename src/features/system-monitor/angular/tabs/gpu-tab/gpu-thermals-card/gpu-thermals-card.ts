import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { GpuReading } from '@shared/api/system-monitor-channels';
import { formatPercent } from '../../../readings/format';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * The temperature a GPU's bar runs to, in °C: about where GPUs begin to throttle.
 */
const TEMPERATURE_SCALE_C: number = 100;

/**
 * Describes one row: a figure, what it is, and where it sits on its bar.
 */
interface ThermalRow {
  /**
   * Gets the row's glyph.
   */
  readonly icon: Icon;

  /**
   * Gets what the figure is, for its accessible name.
   */
  readonly label: string;

  /**
   * Gets the figure, formatted.
   */
  readonly value: string;

  /**
   * Gets a note after the figure (`Fan Stop`), or the empty string.
   */
  readonly note: string;

  /**
   * Gets where the figure sits on its bar, 0–100, or undefined for a row without a bar (no limit to
   * measure it against).
   */
  readonly percent?: number;

  /**
   * Gets how hot the figure runs, which colours its bar.
   */
  readonly tone: 'normal' | 'warning' | 'danger';
}

/**
 * Represents the GPU view's temperature and power card: the GPU's temperature, power draw and fan,
 * each with a bar where there is a scale to measure it against (a temperature's throttling point, a
 * power draw's limit).
 */
@Component({
  selector: 'app-system-monitor-gpu-thermals-card',
  imports: [DashboardCard, AppIcon],
  templateUrl: './gpu-thermals-card.html',
  styleUrl: './gpu-thermals-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuThermalsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets the rows, those the platform reports.
   */
  protected readonly rows: Signal<readonly ThermalRow[]> = computed((): readonly ThermalRow[] => {
    const reading: GpuReading | null = this.gpu.latest();
    if (reading === null) {
      return [];
    }
    const rows: ThermalRow[] = [];
    if (reading.temperatureC !== undefined) {
      const temperature: number = reading.temperatureC;
      rows.push({
        icon: Icon.MONITOR_TEMPERATURE,
        label: 'Temperature',
        value: `${Math.round(temperature)} °C`,
        note: '',
        percent: Math.min(100, (temperature / TEMPERATURE_SCALE_C) * 100),
        tone: temperature >= 90 ? 'danger' : temperature >= 80 ? 'warning' : 'normal',
      });
    }
    if (reading.powerWatts !== undefined) {
      const limit: number | undefined = reading.powerLimitWatts;
      const share: number | undefined =
        limit === undefined || limit <= 0 ? undefined : (reading.powerWatts / limit) * 100;
      rows.push({
        icon: Icon.MONITOR_POWER,
        label: 'Power',
        value: `${Math.round(reading.powerWatts)} W`,
        note: share === undefined ? '' : `${formatPercent(share)} of ${Math.round(limit ?? 0)} W`,
        ...(share === undefined ? {} : { percent: Math.min(100, share) }),
        tone: share !== undefined && share >= 95 ? 'warning' : 'normal',
      });
    }
    if (reading.fanRpm !== undefined || reading.fanPercent !== undefined) {
      const stopped: boolean = reading.fanRpm === 0;
      rows.push({
        icon: Icon.MONITOR_FAN,
        label: 'Fan',
        value:
          reading.fanRpm === undefined
            ? formatPercent(reading.fanPercent ?? 0)
            : `${reading.fanRpm.toLocaleString()} RPM`,
        note: stopped ? 'Fan Stop' : '',
        ...(reading.fanPercent === undefined ? {} : { percent: Math.min(100, reading.fanPercent) }),
        tone: 'normal',
      });
    }
    return rows;
  });
}
