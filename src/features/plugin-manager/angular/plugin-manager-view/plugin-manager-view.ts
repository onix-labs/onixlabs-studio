import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { PluginContribution, PluginSlot, PluginSummary } from '@shared/api/plugin-channels';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { Plugins } from '../plugins/plugins';

/**
 * The plugin table's columns.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Plugin' },
  { id: 'provides', header: 'Provides', width: '30%' },
  { id: 'version', header: 'Version', width: '10rem' },
  { id: 'state', header: 'Status', width: '11rem' },
  { id: 'actions', header: '', width: '9rem', align: 'end' },
];

/**
 * How each slot is described where a plugin's contributions are listed.
 */
const SLOT_LABELS: Readonly<Record<PluginSlot, string>> = {
  'language-server': 'Language server',
  'debug-adapter': 'Debugger',
};

/**
 * The Plugin Manager: the list of plugins Studio knows about, what is installed on this machine, and
 * the controls that change that.
 *
 * This is the first of the plugin model's three layers made visible — *available* and *installed*. What
 * a plugin contributes is shown here as plain text (a Python language server, a C# debugger) because it
 * is the reason to install one; **choosing between** two installed implementations of the same thing is
 * Settings' job, and only arises once more than one is installed.
 */
@Component({
  selector: 'app-plugin-manager-view',
  imports: [Button, AppIcon, Table, TableRowDef],
  templateUrl: './plugin-manager-view.html',
  styleUrl: './plugin-manager-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginManagerView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the table's columns.
   */
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this tab is the active one.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the plugin client the view reads and acts through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets every known plugin, installed first so what is in use leads, adapted to the table's row shape.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    [...this.plugins.plugins()]
      .sort(
        (left: PluginSummary, right: PluginSummary): number =>
          Number(right.state === 'installed') - Number(left.state === 'installed'),
      )
      .map((plugin: PluginSummary): TableRow => ({ id: plugin.id, data: plugin })),
  );

  /**
   * Gets how many plugins are installed, for the summary line.
   */
  protected readonly installedCount: Signal<number> = computed(
    (): number =>
      this.plugins
        .plugins()
        .filter((plugin: PluginSummary): boolean => plugin.state === 'installed').length,
  );

  /**
   * Gets whether an operation is in flight.
   */
  protected readonly busy: Signal<boolean> = this.plugins.busy;

  /**
   * Gets the last action's error, or null.
   */
  protected readonly error: Signal<string | null> = this.plugins.error;

  /**
   * Reads a table row's plugin payload. The table hands its templates the {@link TableRow} wrapper, not
   * the payload, so the cast has to go through `data` — casting the wrapper itself compiles and yields
   * an object whose every field is undefined, which renders as a row of empty cells.
   * @param row The table row.
   * @returns Returns the row's plugin.
   */
  protected plugin(row: TableRow): PluginSummary {
    return row.data as PluginSummary;
  }

  /**
   * Gets the total number of known plugins, for the summary line.
   */
  protected total(): number {
    return this.plugins.plugins().length;
  }

  /**
   * Describes what a plugin contributes, in the user's terms rather than slot identifiers.
   * @param plugin The plugin.
   * @returns Returns a human-readable summary of its contributions.
   */
  protected provides(plugin: PluginSummary): string {
    return plugin.contributions
      .map(
        (contribution: PluginContribution): string =>
          `${SLOT_LABELS[contribution.slot]} for ${contribution.languages.join(', ')}`,
      )
      .join(' · ');
  }

  /**
   * Gets whether the plugin can be installed from here.
   * @param plugin The plugin.
   * @returns Returns true when an Install action applies.
   */
  protected canInstall(plugin: PluginSummary): boolean {
    return plugin.state === 'available';
  }

  /**
   * Gets whether the plugin can be removed from here. Every installed plugin can — that is what makes
   * it a plugin rather than part of the application.
   * @param plugin The plugin.
   * @returns Returns true when a Remove action applies.
   */
  protected canUninstall(plugin: PluginSummary): boolean {
    return plugin.state === 'installed';
  }

  /**
   * Installs a plugin.
   * @param plugin The plugin to install.
   */
  protected install(plugin: PluginSummary): void {
    void this.plugins.install(plugin.id);
  }

  /**
   * Removes a plugin.
   * @param plugin The plugin to remove.
   */
  protected uninstall(plugin: PluginSummary): void {
    void this.plugins.uninstall(plugin.id);
  }

  /**
   * Reloads the plugin list.
   */
  protected refresh(): void {
    void this.plugins.refresh();
  }
}
