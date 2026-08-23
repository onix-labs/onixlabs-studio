import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import {
  RibbonStripMenuButton,
  RibbonMenuItem,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { Icon } from '@shared/angular/icons/icon';
import { ApiExplorerCommands } from '../api-explorer-commands/api-explorer-commands';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';

/**
 * Identifies the Save-As item in the Save menu button's dropdown.
 */
const VARIANT_SAVE_AS: string = 'save-as';

/**
 * The contextual ribbon shown while an API Explorer tab is active: save the collection, and add to
 * the tree. Its actions drive the active view through the {@link ApiExplorerCommands} registry.
 *
 * The File group is deliberately the code editor's, down to the Save-As item hanging off the Save
 * button: an API document is a file like any other, and this is where a user reaches for it. What is
 * absent is as deliberate: sending acts on the request open in the well rather than on the tab, so it
 * lives in that request's own tool strip beside the URL it will send, and the environment is chosen
 * in the explorer tree — where the rest of the tree it belongs to is — and reported in the status
 * strip.
 */
@Component({
  selector: 'app-api-explorer-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripButtonSmall,
    RibbonStripColumn,
    RibbonStripMenuButton,
  ],
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
   * Gets the extra actions offered by the Save menu button's dropdown.
   */
  protected readonly saveItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_SAVE_AS, label: 'Save As', icon: Icon.SAVE_AS },
  ];

  /**
   * Contributes this tab's menu while the API Explorer ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'api-explorer',
    (): readonly MenuContribution[] => [
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'api.save',
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            run: (): void => this.onSave(),
          },
        ],
      },
      {
        id: 'api',
        label: 'API',
        items: [
          { id: 'api.newRequest', label: 'New Request', run: (): void => this.onNewRequest() },
          {
            id: 'api.newCollection',
            label: 'New Collection',
            run: (): void => this.onNewCollection(),
          },
          {
            id: 'api.newEnvironment',
            label: 'New Environment',
            run: (): void => this.onNewEnvironment(),
          },
        ],
      },
    ],
  );

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
   * Adds a request.
   */
  protected onNewRequest(): void {
    this.commands.newRequest();
  }

  /**
   * Names and adds a collection.
   */
  protected onNewCollection(): void {
    this.commands.newCollection();
  }

  /**
   * Names and adds an environment.
   */
  protected onNewEnvironment(): void {
    this.commands.newEnvironment();
  }
}
