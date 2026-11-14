import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { MachineHealth } from '../../../../readings/machine-health';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { SystemFacts } from '../../../system-facts/system-facts';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Represents the Overview's System card: the machine's health at a glance, and its facts.
 */
@Component({
  selector: 'app-system-monitor-system-card',
  imports: [DashboardCard, DashboardBadge, SystemFacts],
  templateUrl: './system-card.html',
  styleUrl: './system-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets when the current logging session started, or null when unknown.
   */
  public readonly sessionStartedAt: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the machine's health.
   */
  protected readonly health: Signal<MachineHealth> = this.readings.health;

  /**
   * Gets the health verdict's tooltip: every pressure found, or that there is none.
   */
  protected readonly healthDetail: Signal<string> = computed((): string => {
    const reasons: readonly string[] = this.health().reasons;
    return reasons.length === 0 ? 'Nothing is under pressure' : reasons.join(', ');
  });

  /**
   * Emits when the user asks for the System view.
   */
  public readonly details: OutputEmitterRef<void> = output<void>();
}
