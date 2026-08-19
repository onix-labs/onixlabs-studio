import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { ApiExplorerCommands } from '../api-explorer-commands/api-explorer-commands';

/**
 * The contextual ribbon shown while an API Explorer tab is active: send the open request, add to the
 * tree, and switch the environment every send resolves against. Its actions drive the active view
 * through the {@link ApiExplorerCommands} registry.
 */
@Component({
  selector: 'app-api-explorer-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton],
  templateUrl: './api-explorer-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiExplorerRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the command registry the buttons drive the active view through.
   */
  private readonly commands: ApiExplorerCommands = inject(ApiExplorerCommands);

  /**
   * Gets whether a request is open and can be sent.
   */
  protected readonly canSend: Signal<boolean> = this.commands.canSend;

  /**
   * Gets whether the open request is in flight, choosing between Send and Cancel.
   */
  protected readonly sending: Signal<boolean> = this.commands.sending;

  /**
   * Gets the label of the environment button: the active environment's name, or an invitation to pick
   * one when none is active.
   */
  protected readonly environmentLabel: Signal<string> = computed(
    (): string => this.commands.environmentName() ?? 'No environment',
  );

  /**
   * Sends the open request, or cancels it when it is already in flight.
   */
  protected onSend(): void {
    this.commands.send();
  }

  /**
   * Adds a request.
   */
  protected onNewRequest(): void {
    this.commands.newRequest();
  }

  /**
   * Adds a collection.
   */
  protected onNewCollection(): void {
    this.commands.newCollection();
  }

  /**
   * Switches to the next environment.
   */
  protected onCycleEnvironment(): void {
    this.commands.cycleEnvironment();
  }
}
