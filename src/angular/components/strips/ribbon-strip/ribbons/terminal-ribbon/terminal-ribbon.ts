import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonCheck } from '../../controls/ribbon-check/ribbon-check';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonField } from '../../controls/ribbon-field/ribbon-field';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';
import { TerminalCommands } from '../../../../../services/terminal-commands/terminal-commands';

/**
 * Represents the contextual ribbon shown when a terminal tab is active. The clipboard and nuke
 * actions drive the active terminal through the {@link TerminalCommands} registry; the remaining
 * controls are static scaffolding.
 */
@Component({
  selector: 'app-terminal-ribbon',
  imports: [RibbonGroup, RibbonColumn, RibbonButton, RibbonButtonSmall, RibbonCheck, RibbonField],
  templateUrl: './terminal-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalRibbon {
  /**
   * Holds the terminal commands registry the ribbon actions are routed through.
   */
  private readonly commands: TerminalCommands = inject(TerminalCommands);

  /**
   * Copies the active terminal's selection to the clipboard.
   */
  protected onCopy(): void {
    this.commands.copy();
  }

  /**
   * Pastes the clipboard contents into the active terminal.
   */
  protected onPaste(): void {
    this.commands.paste();
  }

  /**
   * Clears the active terminal's screen.
   */
  protected onClear(): void {
    this.commands.clear();
  }

  /**
   * Destroys and respawns the active terminal, keeping its identifier.
   */
  protected onNuke(): void {
    this.commands.nuke();
  }
}
