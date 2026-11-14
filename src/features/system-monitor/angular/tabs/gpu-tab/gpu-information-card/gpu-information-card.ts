import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { GpuInfo, GpuReading } from '@shared/api/system-monitor-channels';
import { formatBytes } from '../../../readings/format';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one row of the GPU's description.
 */
interface InformationRow {
  /**
   * Gets the row's label.
   */
  readonly label: string;

  /**
   * Gets the row's value.
   */
  readonly value: string;
}

/**
 * Represents the GPU view's information card: the GPU described — its model, maker, architecture,
 * driver, video memory and bus — and its clocks as last read, each as far as the platform reports it.
 */
@Component({
  selector: 'app-system-monitor-gpu-information-card',
  imports: [DashboardCard],
  templateUrl: './gpu-information-card.html',
  styleUrl: './gpu-information-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuInformationCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings, for the GPU's description.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the view's GPU readings, for its clocks.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets the rows the platform reports.
   */
  protected readonly rows: Signal<readonly InformationRow[]> = computed(
    (): readonly InformationRow[] => {
      const info: GpuInfo | undefined = this.readings.info()?.gpus[0];
      const reading: GpuReading | null = this.gpu.latest();
      const rows: InformationRow[] = [];
      const add: (label: string, value: string | undefined) => void = (
        label: string,
        value: string | undefined,
      ): void => {
        if (value !== undefined && value.length > 0) {
          rows.push({ label, value });
        }
      };
      add('Model', info?.model);
      add('Vendor', info?.vendor);
      add('Architecture', info?.architecture);
      add('Driver', info?.driver);
      add('VRAM', info?.memoryBytes === undefined ? undefined : formatBytes(info.memoryBytes));
      add('Bus', info?.bus);
      add(
        'Core Clock',
        reading?.coreClockMhz === undefined ? undefined : `${reading.coreClockMhz} MHz`,
      );
      add(
        'Memory Clock',
        reading?.memoryClockMhz === undefined ? undefined : `${reading.memoryClockMhz} MHz`,
      );
      return rows;
    },
  );
}
