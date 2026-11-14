import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { GpuInfo, GpuReading } from '@shared/api/system-monitor-channels';
import { formatBytes, formatPercent } from '../../readings/format';
import { SystemMonitorGpu } from '../../readings/system-monitor-gpu';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { GpuEnginesCard } from './gpu-engines-card/gpu-engines-card';
import { GpuHistoryCard } from './gpu-history-card/gpu-history-card';
import { GpuInformationCard } from './gpu-information-card/gpu-information-card';
import { GpuMemoryCard } from './gpu-memory-card/gpu-memory-card';
import { GpuMemoryHistoryCard } from './gpu-memory-history-card/gpu-memory-history-card';
import { GpuProcessesCard } from './gpu-processes-card/gpu-processes-card';
import { GpuThermalsCard } from './gpu-thermals-card/gpu-thermals-card';
import { GpuUtilisationCard } from './gpu-utilisation-card/gpu-utilisation-card';

/**
 * Describes one of the header's summary chips (`Temp: 62 °C`).
 */
interface SummaryChip {
  /**
   * Gets what the reading is.
   */
  readonly label: string;

  /**
   * Gets the reading.
   */
  readonly value: string;
}

/**
 * Represents the System Monitor's GPU view: the GPU named with its headline figures, then its
 * utilisation, video memory, temperature and power, engines, video memory over time, the processes
 * using it, its description, and its utilisation over spans of up to a day. Every figure is one the
 * platform reports; what it does not is left out or said to be unavailable. Where GPU Monitoring is
 * off, the view says so instead.
 */
@Component({
  selector: 'app-system-monitor-gpu-tab',
  imports: [
    AppIcon,
    GpuUtilisationCard,
    GpuMemoryCard,
    GpuThermalsCard,
    GpuEnginesCard,
    GpuMemoryHistoryCard,
    GpuProcessesCard,
    GpuInformationCard,
    GpuHistoryCard,
  ],
  templateUrl: './gpu-tab.html',
  styleUrl: './gpu-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuTab {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings, for the GPU's description and GPU Monitoring.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets the GPU's model, or the empty string until it is described.
   */
  protected readonly model: Signal<string> = computed(
    (): string => this.readings.info()?.gpus[0]?.model ?? '',
  );

  /**
   * Gets the header's chips, those the platform reports: the driver, video memory, bus, power and
   * temperature.
   */
  protected readonly chips: Signal<readonly SummaryChip[]> = computed(
    (): readonly SummaryChip[] => {
      const info: GpuInfo | undefined = this.readings.info()?.gpus[0];
      const reading: GpuReading | null = this.gpu.latest();
      const chips: SummaryChip[] = [];
      if (info?.driver !== undefined) {
        chips.push({ label: 'Driver', value: info.driver });
      }
      const vram: number | undefined = reading?.memoryTotalBytes ?? info?.memoryBytes;
      if (vram !== undefined) {
        chips.push({ label: 'VRAM', value: formatBytes(vram) });
      }
      if (info?.bus !== undefined) {
        chips.push({ label: 'Bus', value: info.bus });
      }
      if (reading?.powerWatts !== undefined) {
        const limit: number | undefined = reading.powerLimitWatts;
        chips.push({
          label: 'Power',
          value:
            limit === undefined || limit <= 0
              ? `${Math.round(reading.powerWatts)} W`
              : `${Math.round(reading.powerWatts)} W (${formatPercent((reading.powerWatts / limit) * 100)})`,
        });
      }
      if (reading?.temperatureC !== undefined) {
        chips.push({ label: 'Temp', value: `${Math.round(reading.temperatureC)} °C` });
      }
      return chips;
    },
  );
}
