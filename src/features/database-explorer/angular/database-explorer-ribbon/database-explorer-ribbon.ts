import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { Icon } from '@shared/angular/icons/icon';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import {
  MENU_SEPARATOR,
  MenuContribution,
  MenuEntry,
} from '@shared/angular/services/app-menu/app-menu-model';
import {
  DatabaseExplorerCommands,
  RibbonPanel,
} from '../database-explorer-commands/database-explorer-commands';

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
 * The contextual ribbon of a Database Explorer tab (#1102), grouped by what each command acts on:
 * File (Save, its passphrase items), Connection (New, Connect/Disconnect, Refresh, Edit — on the
 * selected connection, else the front query's), Query (New, Execute/Cancel), and Tools (a toggle per
 * tool panel, and Reset Layout). The app menu carries the same commands. Its actions drive the active
 * view through the {@link DatabaseExplorerCommands} registry.
 */
@Component({
  selector: 'app-database-explorer-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripButton,
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
      <!-- What the Connection buttons act on: the connection selected in the Object Explorer (or the
           one the selected item belongs to), else the connection of the query in front (#1102). -->
      <app-ribbon-strip-group title="Connection">
        <app-ribbon-strip-button
          [icon]="Icon.DATABASE_CONNECTION"
          label="New"
          (action)="commands.newConnection()"
        />
        <app-ribbon-strip-button
          [icon]="
            commands.connectionTarget()?.state === 'open'
              ? Icon.DATABASE_DISCONNECT
              : Icon.DATABASE_CONNECT
          "
          [label]="commands.connectionTarget()?.state === 'open' ? 'Disconnect' : 'Connect'"
          [disabled]="
            commands.connectionTarget() === null ||
            commands.connectionTarget()?.state === 'connecting'
          "
          (action)="commands.toggleConnection()"
        />
        <app-ribbon-strip-column>
          <app-ribbon-strip-button-small
            [icon]="Icon.REFRESH"
            label="Refresh"
            [disabled]="commands.connectionTarget()?.state !== 'open'"
            (action)="commands.refreshConnection()"
          />
          <app-ribbon-strip-button-small
            [icon]="Icon.PENCIL"
            label="Edit"
            [disabled]="commands.connectionTarget() === null"
            (action)="commands.editConnection()"
          />
        </app-ribbon-strip-column>
      </app-ribbon-strip-group>
      <app-ribbon-strip-group title="Query">
        <app-ribbon-strip-button
          [icon]="Icon.DATABASE_QUERY"
          label="New"
          (action)="commands.newQuery()"
        />
        <app-ribbon-strip-button
          [icon]="commands.executing() ? Icon.STOP : Icon.PLAY"
          [label]="commands.executing() ? 'Cancel' : 'Execute'"
          [disabled]="!commands.canExecute()"
          (action)="commands.execute()"
        />
      </app-ribbon-strip-group>
      <!-- Each tool panel as a toggle, lit while it is showing, so a closed one can always come back. -->
      <app-ribbon-strip-group title="Tools">
        @for (panel of commands.panels(); track panel.id) {
          <app-ribbon-strip-button
            [icon]="panel.icon"
            [label]="panel.title"
            [toggle]="true"
            [pressed]="panel.open"
            (action)="commands.togglePanel(panel.id)"
          />
        }
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
          {
            id: 'database.saveAs',
            label: 'Save As',
            accelerator: 'CmdOrCtrl+Shift+S',
            run: (): void => this.commands.saveDocumentAs(),
          },
          MENU_SEPARATOR,
          ...(this.commands.locked()
            ? [
                {
                  id: 'database.unlockPassphrase',
                  label: 'Unlock Passwords',
                  run: (): void => this.commands.unlockPassphrase(),
                },
              ]
            : []),
          {
            id: 'database.setPassphrase',
            label: this.commands.hasPassphrase() ? 'Change Passphrase' : 'Set Passphrase',
            run: (): void => this.commands.setPassphrase(),
          },
          ...(this.commands.hasPassphrase()
            ? [
                {
                  id: 'database.removePassphrase',
                  label: 'Remove Passphrase',
                  run: (): void => this.commands.removePassphrase(),
                },
              ]
            : []),
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
            id: 'database.toggleConnection',
            label: this.commands.connectionTarget()?.state === 'open' ? 'Disconnect' : 'Connect',
            enabled:
              this.commands.connectionTarget() !== null &&
              this.commands.connectionTarget()?.state !== 'connecting',
            run: (): void => this.commands.toggleConnection(),
          },
          {
            id: 'database.refreshConnection',
            label: 'Refresh Connection',
            enabled: this.commands.connectionTarget()?.state === 'open',
            run: (): void => this.commands.refreshConnection(),
          },
          {
            id: 'database.editConnection',
            label: 'Edit Connection',
            enabled: this.commands.connectionTarget() !== null,
            run: (): void => this.commands.editConnection(),
          },
          MENU_SEPARATOR,
          {
            id: 'database.newQuery',
            label: 'New Query',
            run: (): void => this.commands.newQuery(),
          },
          {
            id: 'database.execute',
            label: this.commands.executing() ? 'Cancel Query' : 'Execute Query',
            enabled: this.commands.canExecute(),
            run: (): void => this.commands.execute(),
          },
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: [
          ...this.commands.panels().map((panel: RibbonPanel): MenuEntry => ({
            id: `database.panel.${panel.id}`,
            label: panel.title,
            kind: 'checkbox',
            checked: panel.open,
            run: (): void => this.commands.togglePanel(panel.id),
          })),
          MENU_SEPARATOR,
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
