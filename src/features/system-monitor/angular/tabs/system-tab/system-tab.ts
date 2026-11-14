import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { MachineHealth } from '../../readings/machine-health';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { SystemFacts } from '../system-facts/system-facts';

/**
 * Represents the System Monitor's System view: the machine's health and its facts.
 */
@Component({
  selector: 'app-system-monitor-system-tab',
  imports: [SystemFacts],
  templateUrl: './system-tab.html',
  styleUrl: './system-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemTab {
  /**
   * Gets when the current logging session started, or null when unknown.
   */
  public readonly sessionStartedAt: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the machine's health.
   */
  protected readonly health: Signal<MachineHealth> = inject(SystemMonitorReadings).health;

  /**
   * Gets every pressure found, in a line.
   */
  protected readonly reasons: Signal<string> = computed((): string =>
    this.health().reasons.join(', '),
  );
}
