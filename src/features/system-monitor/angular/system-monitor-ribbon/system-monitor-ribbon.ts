import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { SystemMonitorCommands } from '../system-monitor-commands/system-monitor-commands';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';

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
   * Contributes this tab's menu while the System Monitor ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'system-monitor',
    (): readonly MenuContribution[] => [
      {
        id: 'edit',
        label: 'Edit',
        items: [
          // Never disabled, unlike the ribbon's Copy button: this entry also carries ⌘C for a text
          // box focused anywhere on the tab, and a disabled entry's accelerator is dead. Copying an
          // empty audit is a no-op rather than an error, so nothing is lost by leaving it enabled.
          {
            id: 'monitor.copy',
            label: 'Copy',
            accelerator: 'CmdOrCtrl+C',
            editingRole: 'copy',
            run: (): void => this.onCopy(),
          },
        ],
      },
      {
        id: 'monitor',
        label: 'Monitor',
        items: [
          {
            id: 'monitor.refresh',
            label: 'Refresh',
            accelerator: 'CmdOrCtrl+Shift+R',
            run: (): void => this.onRefresh(),
          },
          { id: 'monitor.clearFilters', label: 'Clear Filters', run: (): void => this.onClear() },
        ],
      },
    ],
  );

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
