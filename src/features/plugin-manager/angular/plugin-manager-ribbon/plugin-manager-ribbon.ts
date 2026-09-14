import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { type RibbonFieldOption } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  PluginBrowse,
  type PluginSort,
  type PluginStateFilter,
} from '../plugin-browse/plugin-browse';
import { Icon } from '@shared/angular/icons/icon';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * The contextual ribbon shown while a Plugin Manager tab is active: reloading the catalogue, narrowing
 * the list by install state, searching it, and ordering it.
 *
 * ⛔ Installing and removing stay on the rows they act on. A strip button would need a selection model
 * to know which plugin it meant, and a list where the action is somewhere else is a list you have to
 * look away from to use.
 *
 * The narrowing controls write to {@link PluginBrowse} rather than to the view, because the view is a
 * sibling: the ribbon owns the controls, the view renders the result, and the status strip counts it.
 */
@Component({
  selector: 'app-plugin-manager-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripButton,
    RibbonStripColumn,
    RibbonStripField,
    TextField,
  ],
  templateUrl: './plugin-manager-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginManagerRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the browsing state the controls drive.
   */
  protected readonly browse: PluginBrowse = inject(PluginBrowse);

  /**
   * Gets the orderings offered by the Sort field.
   */
  protected readonly sortOptions: readonly RibbonFieldOption[] = [
    { value: 'name', label: 'Name' },
    { value: 'category', label: 'Category' },
    { value: 'state', label: 'Installed first' },
  ];

  /**
   * Narrows the list to an install state.
   * @param state The state to show.
   */
  protected onState(state: PluginStateFilter): void {
    this.browse.stateFilter.set(state);
  }

  /**
   * Orders the list.
   * @param sort The ordering, as the field's string value.
   */
  protected onSort(sort: string): void {
    this.browse.sort.set(sort as PluginSort);
  }

  /**
   * Holds the plugin client the ribbon acts through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets whether an operation is in flight, disabling the action.
   */
  protected readonly busy: Signal<boolean> = this.plugins.busy;

  /**
   * Contributes this tab's menu while the plugin-manager ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'plugin-manager',
    (): readonly MenuContribution[] => [
      {
        id: 'plugins',
        label: 'Plugins',
        items: [
          {
            id: 'plugins.refresh',
            label: 'Refresh',
            run: (): void => this.onRefresh(),
          },
        ],
      },
    ],
  );

  /**
   * Reloads what is installed.
   */
  protected onRefresh(): void {
    void this.plugins.refresh();
  }
}
