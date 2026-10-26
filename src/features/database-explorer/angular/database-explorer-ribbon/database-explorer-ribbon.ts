import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { Icon } from '@shared/angular/icons/icon';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { DatabaseExplorerCommands } from '../database-explorer-commands/database-explorer-commands';

/**
 * Identifies the Save-As item in the Save menu button's dropdown.
 */
const VARIANT_SAVE_AS: string = 'save-as';

/**
 * Identifies the passphrase items in the Save menu button's dropdown.
 */
const VARIANT_SET_PASSPHRASE: string = 'set-passphrase';
const VARIANT_UNLOCK: string = 'unlock-passphrase';
const VARIANT_REMOVE_PASSPHRASE: string = 'remove-passphrase';

/**
 * The contextual ribbon of a Database Explorer tab: save the document, add a connection or a query,
 * and run the query open in the well. Its actions drive the active view through the
 * {@link DatabaseExplorerCommands} registry.
 */
@Component({
  selector: 'app-database-explorer-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripButtonSmall,
    RibbonStripColumn,
    RibbonStripMenuButton,
  ],
  template: `
    <app-ribbon-overflow>
      <app-ribbon-strip-group title="File">
        <app-ribbon-strip-menu-button
          [icon]="Icon.SAVE"
          label="Save"
          [items]="saveItems()"
          (action)="commands.saveDocument()"
          (selected)="onSaveVariant($event)"
        />
      </app-ribbon-strip-group>
      <app-ribbon-strip-group title="New">
        <app-ribbon-strip-column>
          <app-ribbon-strip-button-small
            [icon]="Icon.DATABASE_CONNECTION"
            label="Connection"
            (action)="commands.newConnection()"
          />
          <app-ribbon-strip-button-small
            [icon]="Icon.DATABASE_QUERY"
            label="Query"
            (action)="commands.newQuery()"
          />
        </app-ribbon-strip-column>
      </app-ribbon-strip-group>
      <app-ribbon-strip-group title="Query">
        <app-ribbon-strip-column>
          <app-ribbon-strip-button-small
            [icon]="commands.executing() ? Icon.STOP : Icon.PLAY"
            [label]="commands.executing() ? 'Cancel' : 'Execute'"
            [disabled]="!commands.canExecute()"
            (action)="commands.execute()"
          />
        </app-ribbon-strip-column>
      </app-ribbon-strip-group>
      <app-ribbon-strip-group title="View">
        <app-ribbon-strip-column>
          <app-ribbon-strip-button-small
            [icon]="Icon.DATABASE_RESET_LAYOUT"
            label="Reset Layout"
            (action)="commands.resetLayout()"
          />
        </app-ribbon-strip-column>
      </app-ribbon-strip-group>
    </app-ribbon-overflow>
  `,
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatabaseExplorerRibbon {
  protected readonly Icon: typeof Icon = Icon;
  protected readonly commands: DatabaseExplorerCommands = inject(DatabaseExplorerCommands);

  /**
   * Gets the Save menu button's extra actions.
   */
  protected readonly saveItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] => [
      { id: VARIANT_SAVE_AS, label: 'Save As', icon: Icon.SAVE_AS },
      ...(this.commands.locked()
        ? [{ id: VARIANT_UNLOCK, label: 'Unlock Passwords', icon: Icon.DATABASE_UNLOCK }]
        : []),
      {
        id: VARIANT_SET_PASSPHRASE,
        label: this.commands.hasPassphrase() ? 'Change Passphrase' : 'Set Passphrase',
        icon: Icon.DATABASE_PASSPHRASE,
      },
      ...(this.commands.hasPassphrase()
        ? [
            {
              id: VARIANT_REMOVE_PASSPHRASE,
              label: 'Remove Passphrase',
              icon: Icon.DATABASE_REMOVE_PASSPHRASE,
            },
          ]
        : []),
    ],
  );

  /**
   * Contributes this tab's menu while the ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'database-explorer',
    (): readonly MenuContribution[] => [
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'database.save',
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            run: (): void => this.commands.saveDocument(),
          },
        ],
      },
      {
        id: 'database',
        label: 'Database',
        items: [
          {
            id: 'database.newConnection',
            label: 'New Connection',
            run: (): void => this.commands.newConnection(),
          },
          {
            id: 'database.newQuery',
            label: 'New Query',
            run: (): void => this.commands.newQuery(),
          },
          {
            id: 'database.execute',
            label: 'Execute Query',
            run: (): void => this.commands.execute(),
          },
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: [
          {
            id: 'database.resetLayout',
            label: 'Reset Layout',
            run: (): void => this.commands.resetLayout(),
          },
        ],
      },
    ],
  );

  /**
   * Runs the action chosen from the Save menu button's dropdown.
   * @param id The chosen variant.
   */
  protected onSaveVariant(id: string): void {
    switch (id) {
      case VARIANT_SAVE_AS:
        this.commands.saveDocumentAs();
        return;
      case VARIANT_SET_PASSPHRASE:
        this.commands.setPassphrase();
        return;
      case VARIANT_UNLOCK:
        this.commands.unlockPassphrase();
        return;
      case VARIANT_REMOVE_PASSPHRASE:
        this.commands.removePassphrase();
        return;
    }
    this.commands.saveDocument();
  }
}
