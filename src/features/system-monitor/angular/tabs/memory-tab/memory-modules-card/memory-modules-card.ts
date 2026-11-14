import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Chip } from '@shared/angular/components/chip/chip';
import { Icon } from '@shared/angular/icons/icon';
import { MemoryModule, SystemInfo } from '@shared/api/system-monitor-channels';
import { formatBytes } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one module's row.
 */
interface ModuleRow {
  /**
   * Gets the module's slot.
   */
  readonly slot: string;

  /**
   * Gets the module's size, formatted.
   */
  readonly size: string;

  /**
   * Gets the module's type.
   */
  readonly type: string;

  /**
   * Gets the module's data rate, formatted, or a placeholder.
   */
  readonly speed: string;

  /**
   * Gets the module's status, or the empty string where the platform reports none.
   */
  readonly status: string;

  /**
   * Gets whether the status is good.
   */
  readonly ok: boolean;

  /**
   * Gets the module's maker and part, for its tooltip.
   */
  readonly detail: string;
}

/**
 * Represents the Memory view's physical memory card: each installed module (DIMM) — its slot, size,
 * type, speed and status — and how many of the slots are filled, where the platform reports them.
 */
@Component({
  selector: 'app-system-monitor-memory-modules-card',
  imports: [DashboardCard, Chip],
  templateUrl: './memory-modules-card.html',
  styleUrl: './memory-modules-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryModulesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the card's title, counting the slots filled where the slot count is known.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const info: SystemInfo | null = this.readings.info();
    if (info === null || info.memoryModules.length === 0 || info.memorySlots === undefined) {
      return 'Physical Memory (DIMMs)';
    }
    return `Physical Memory (${info.memoryModules.length} of ${info.memorySlots} slots)`;
  });

  /**
   * Gets whether the machine has been described yet.
   */
  protected readonly described: Signal<boolean> = computed(
    (): boolean => this.readings.info() !== null,
  );

  /**
   * Gets one row per installed module.
   */
  protected readonly rows: Signal<readonly ModuleRow[]> = computed((): readonly ModuleRow[] =>
    (this.readings.info()?.memoryModules ?? []).map((module: MemoryModule): ModuleRow => ({
      slot: module.slot,
      size: formatBytes(module.sizeBytes).replace('.0 ', ' '),
      type: module.type.length > 0 ? module.type : '—',
      speed: module.speedMts === undefined ? '—' : `${module.speedMts} MT/s`,
      status: module.status ?? '',
      ok: module.status === 'OK',
      detail: [module.manufacturer, module.partNumber]
        .filter((part: string): boolean => part.length > 0)
        .join(' '),
    })),
  );
}
