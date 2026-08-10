import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { SystemMonitorCommands } from '../system-monitor-commands/system-monitor-commands';

/**
 * The contextual ribbon shown while a System Monitor tab is active. Its actions drive the active view
 * through the {@link SystemMonitorCommands} registry: refresh reloads the audit, clear resets the
 * filters, and copy is enabled only when the audit shows records. The stateful filters (session,
 * severity, text) live in the view's own toolbar, alongside the table they act on.
 */
@Component({
  selector: 'app-system-monitor-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton],
  templateUrl: './system-monitor-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemMonitorRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the command registry the buttons drive the active view through.
   */
  private readonly commands: SystemMonitorCommands = inject(SystemMonitorCommands);

  /**
   * Gets whether the active view's audit shows any records, gating Copy.
   */
  protected readonly hasRecords: Signal<boolean> = this.commands.hasRecords;

  /**
   * Reloads the audit.
   */
  protected onRefresh(): void {
    this.commands.refresh();
  }

  /**
   * Resets the filters.
   */
  protected onClear(): void {
    this.commands.clearFilters();
  }

  /**
   * Copies the shown records to the clipboard.
   */
  protected onCopy(): void {
    this.commands.copy();
  }
}
