import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { ModelManagerCommands } from '../model-manager-commands/model-manager-commands';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';

/**
 * The contextual ribbon shown while an AI Model Manager tab is active. Its actions drive the active
 * view through the {@link ModelManagerCommands} registry: refresh reloads everything, and start/stop
 * control the runtime's server.
 *
 * Stop is disabled for a server Studio did not start — the user's own Ollama is reachable but not
 * Studio's to kill — which is why the registry exposes `stoppable` separately from `running`.
 */
@Component({
  selector: 'app-model-manager-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton],
  templateUrl: './model-manager-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelManagerRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the command registry the buttons drive the active view through.
   */
  private readonly commands: ModelManagerCommands = inject(ModelManagerCommands);

  /**
   * Gets whether the runtime's server is running, choosing between Start and Stop.
   */
  protected readonly running: Signal<boolean> = this.commands.running;

  /**
   * Gets whether the running server may be stopped by Studio.
   */
  protected readonly stoppable: Signal<boolean> = this.commands.stoppable;

  /**
   * Gets whether an operation is in flight, disabling the actions.
   */
  protected readonly busy: Signal<boolean> = this.commands.busy;

  /**
   * Contributes this tab's menu while the model-manager ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'model-manager',
    (): readonly MenuContribution[] => [
      {
        id: 'models',
        label: 'Models',
        items: [
          {
            id: 'models.start',
            label: 'Start Runtime',
            enabled: !this.running() && !this.busy(),
            run: (): void => this.onStart(),
          },
          {
            id: 'models.stop',
            label: 'Stop Runtime',
            enabled: this.stoppable() && !this.busy(),
            run: (): void => this.onStop(),
          },
          MENU_SEPARATOR,
          {
            id: 'models.refresh',
            label: 'Refresh',
            accelerator: 'CmdOrCtrl+Shift+R',
            run: (): void => this.onRefresh(),
          },
        ],
      },
    ],
  );

  /**
   * Reloads the models and status.
   */
  protected onRefresh(): void {
    this.commands.refresh();
  }

  /**
   * Starts the runtime's server.
   */
  protected onStart(): void {
    this.commands.start();
  }

  /**
   * Stops the runtime's server.
   */
  protected onStop(): void {
    this.commands.stop();
  }
}
