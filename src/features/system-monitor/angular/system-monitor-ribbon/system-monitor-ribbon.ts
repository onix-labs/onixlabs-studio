import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { SystemMonitorCommands } from '../system-monitor-commands/system-monitor-commands';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import {
  MENU_SEPARATOR,
  MenuContribution,
  MenuEntry,
} from '@shared/angular/services/app-menu/app-menu-model';
import { SystemMonitorTabId } from '../tabs/system-monitor-tab-id';

/**
 * Describes one of the monitor's views, as the View group and the Monitor menu offer it.
 */
interface MonitorView {
  /**
   * Gets the view.
   */
  readonly tab: SystemMonitorTabId;

  /**
   * Gets the view's name.
   */
  readonly label: string;

  /**
   * Gets the view's icon.
   */
  readonly icon: Icon;
}

/**
 * Holds the monitor's views, in the order the View group shows them.
 */
const VIEWS: readonly MonitorView[] = [
  { tab: SystemMonitorTabId.Overview, label: 'Overview', icon: Icon.MONITOR_OVERVIEW },
  { tab: SystemMonitorTabId.Cpu, label: 'CPU', icon: Icon.MONITOR_CPU },
  { tab: SystemMonitorTabId.Memory, label: 'Memory', icon: Icon.MONITOR_MEMORY },
  { tab: SystemMonitorTabId.Gpu, label: 'GPU', icon: Icon.MONITOR_GPU },
  { tab: SystemMonitorTabId.Processes, label: 'Processes', icon: Icon.MONITOR_PROCESSES },
  { tab: SystemMonitorTabId.Storage, label: 'Storage', icon: Icon.MONITOR_STORAGE },
  { tab: SystemMonitorTabId.Network, label: 'Network', icon: Icon.MONITOR_NETWORK },
  { tab: SystemMonitorTabId.Logs, label: 'Logs', icon: Icon.MONITOR_LOGS },
];

/**
 * The contextual ribbon shown while a System Monitor tab is active. It is the monitor's tab strip: the
 * View group's buttons switch between its views (Overview, each resource, and Logs), the one
 * showing pressed. Its actions drive the active monitor through the {@link SystemMonitorCommands}
 * registry. The Audit and Clipboard groups belong to the logs, so they appear only on the Logs view:
 * refresh reloads the audit, clear resets the filters, and copy is enabled only when the audit shows
 * records. The stateful filters (session, severity, text) live in the view's own toolbar, alongside
 * the table they act on.
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
   * Gets whether the active view's agent is showing.
   */
  protected readonly agentShown: Signal<boolean> = this.commands.agentShown;

  /**
   * Gets the view the active monitor is showing.
   */
  protected readonly tab: Signal<SystemMonitorTabId | undefined> = this.commands.tab;

  /**
   * Gets the view identities, exposed for the template.
   */
  protected readonly Tab: typeof SystemMonitorTabId = SystemMonitorTabId;

  /**
   * Gets the monitor's views, for the View group.
   */
  protected readonly views: readonly MonitorView[] = VIEWS;

  /**
   * Contributes this tab's menu while the System Monitor ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'system-monitor',
    (): readonly MenuContribution[] => [
      // No Edit section. Copying the audit is offered by the ribbon's Copy button alone: an entry
      // here would have to carry ⌘C, and a feature entry claiming that accelerator replaces the
      // core's native role, taking the chord from every text box on the tab.
      {
        id: 'monitor',
        label: 'Monitor',
        items: [
          ...VIEWS.map((view: MonitorView): MenuEntry => ({
            id: `monitor.view.${view.tab}`,
            label: view.label,
            kind: 'checkbox',
            checked: this.tab() === view.tab,
            run: (): void => this.onSelect(view.tab),
          })),
          MENU_SEPARATOR,
          {
            id: 'monitor.refresh',
            label: 'Refresh',
            binding: 'monitor.refresh',
            run: (): void => this.onRefresh(),
          },
          { id: 'monitor.clearFilters', label: 'Clear Filters', run: (): void => this.onClear() },
          {
            id: 'monitor.agent',
            label: 'Agent',
            kind: 'checkbox',
            checked: this.agentShown(),
            run: (): void => this.onToggleAgent(),
          },
        ],
      },
    ],
  );

  /**
   * Shows a view in the active monitor (the View group, and the Monitor menu's view entries).
   * @param tab The view to show.
   */
  protected onSelect(tab: SystemMonitorTabId): void {
    this.commands.selectTab(tab);
  }

  /**
   * Reloads the logs (the Audit group's Refresh).
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

  /**
   * Shows or hides the docked agent.
   */
  protected onToggleAgent(): void {
    this.commands.toggleAgent();
  }
}
