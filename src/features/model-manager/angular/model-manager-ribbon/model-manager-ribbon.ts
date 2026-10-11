import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  ModelGroupId,
  ModelManagerCommands,
} from '../model-manager-commands/model-manager-commands';
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
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton, TextField],
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
   * Gets whether the runtime is not installed, which turns Start into Install.
   */
  protected readonly needsInstall: Signal<boolean> = this.commands.needsInstall;

  /**
   * Gets the open group of the list, so its button shows pressed.
   */
  protected readonly shownGroup: Signal<ModelGroupId | null> = this.commands.shownGroup;

  /**
   * Gets the groups that have models to list; an empty group's button is disabled, since there is
   * nothing for it to open.
   */
  protected readonly presentGroups: Signal<readonly ModelGroupId[]> = this.commands.presentGroups;

  /**
   * Gets the search text.
   */
  protected readonly searchText: Signal<string> = this.commands.searchText;

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
            id: 'models.install',
            label: 'Install Runtime',
            enabled: this.needsInstall() && !this.busy(),
            run: (): void => this.onInstall(),
          },
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

  /**
   * Installs the runtime.
   */
  protected onInstall(): void {
    this.commands.installRuntime();
  }

  /**
   * Opens a group of the list.
   * @param group The group to open.
   */
  protected onGroup(group: ModelGroupId): void {
    this.commands.openGroup(group);
  }

  /**
   * Filters the list.
   * @param text The search text.
   */
  protected onSearch(text: string): void {
    this.commands.search(text);
  }
}
