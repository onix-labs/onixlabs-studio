import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MetricTile } from '../../metric-tile/metric-tile';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';

/**
 * Represents the System Monitor's GPU tab: the GPU's utilisation, where the platform reports it.
 */
@Component({
  selector: 'app-system-monitor-gpu-tab',
  imports: [MetricTile],
  templateUrl: './gpu-tab.html',
  styleUrl: './gpu-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuTab {
  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);
}
