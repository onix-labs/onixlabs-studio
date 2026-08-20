import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import {
  RibbonStripMenuButton,
  RibbonMenuItem,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { Icon } from '@shared/angular/icons/icon';
import { ApiExplorerCommands } from '../api-explorer-commands/api-explorer-commands';

/**
 * Identifies the Save-As item in the Save menu button's dropdown.
 */
const VARIANT_SAVE_AS: string = 'save-as';

/**
 * The contextual ribbon shown while an API Explorer tab is active: save the collection, send the open
 * request, add to the tree, and switch the environment every send resolves against. Its actions drive
 * the active view through the {@link ApiExplorerCommands} registry.
 *
 * The File group is deliberately the code editor's, down to the Save-As item hanging off the Save
 * button: an API document is a file like any other, and this is where a user reaches for it.
 */
@Component({
  selector: 'app-api-explorer-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton, RibbonStripMenuButton],
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
   * Gets the extra actions offered by the Save menu button's dropdown.
   */
  protected readonly saveItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_SAVE_AS, label: 'Save As', icon: Icon.SAVE_AS },
  ];

  /**
   * Saves the collection to its file, asking for one when it is still untitled.
   */
  protected onSave(): void {
    this.commands.saveDocument();
  }

  /**
   * Runs the action chosen from the Save menu button's dropdown.
   * @param id The chosen save variant's identifier.
   */
  protected onSaveVariant(id: string): void {
    if (id === VARIANT_SAVE_AS) {
      this.commands.saveDocumentAs();
      return;
    }
    this.commands.saveDocument();
  }

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
