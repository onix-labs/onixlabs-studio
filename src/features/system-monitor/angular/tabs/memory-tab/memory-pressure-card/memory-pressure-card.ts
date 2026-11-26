import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { MemoryPressure } from '@shared/api/system-monitor-channels';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes the pressure as the card states it.
 */
interface PressureState {
  /**
   * Gets the level.
   */
  readonly level: MemoryPressure['level'];

  /**
   * Gets the level in a word.
   */
  readonly label: string;

  /**
   * Gets what the level means.
   */
  readonly description: string;

  /**
   * Gets the level's glyph, so it reads by more than colour.
   */
  readonly icon: Icon;

  /**
   * Gets the pressure, 0–100.
   */
  readonly percent: number;
}

/**
 * How each level is stated.
 */
const LEVELS: Readonly<Record<MemoryPressure['level'], Omit<PressureState, 'level' | 'percent'>>> =
  {
    normal: {
      label: 'Normal',
      description: 'The system has plenty of memory available.',
      icon: Icon.SUCCESS_FILL,
    },
    warning: {
      label: 'Warning',
      description: 'Memory is in demand: the system is compressing and swapping to keep up.',
      icon: Icon.WARNING_FILL,
    },
    critical: {
      label: 'Critical',
      description: 'Memory is short: apps may slow, and the system may end some to recover it.',
      icon: Icon.ERROR_FILL,
    },
  };

/**
 * Represents the Memory view's pressure card: how hard pressed memory is — in a word, an icon and a
 * colour — what that means, and a bar of the pressure.
 */
@Component({
  selector: 'app-system-monitor-memory-pressure-card',
  imports: [DashboardCard, AppIcon],
  templateUrl: './memory-pressure-card.html',
  styleUrl: './memory-pressure-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryPressureCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the pressure as stated, or null where the platform does not report it.
   */
  protected readonly state: Signal<PressureState | null> = computed((): PressureState | null => {
    const pressure: MemoryPressure | undefined = this.readings.memoryDetail()?.pressure;
    return pressure === undefined
      ? null
      : { level: pressure.level, percent: pressure.percent, ...LEVELS[pressure.level] };
  });
}
