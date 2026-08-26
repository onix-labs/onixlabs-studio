import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * The contextual ribbon shown while a Plugin Manager tab is active. There is one action — reload what
 * is installed — because installing and removing belong on the rows they act on, not on a strip that
 * would need a selection model to know which plugin it meant.
 *
 * It drives the {@link Plugins} client directly rather than through a command registry: the client is
 * application-scoped and the ribbon needs no view-scoped state, so a registry would be indirection
 * with nothing in it.
 */
@Component({
  selector: 'app-plugin-manager-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton],
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
