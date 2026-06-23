import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { RibbonStripButton } from '../../ribbon-strip-button/ribbon-strip-button';
import { RibbonStripCheck } from '../../ribbon-strip-check/ribbon-strip-check';
import { RibbonStripColumn } from '../../ribbon-strip-column/ribbon-strip-column';
import { RibbonStripGroup } from '../../ribbon-strip-group/ribbon-strip-group';
import { TerminalCommands } from '../../../../../services/terminal-commands/terminal-commands';

/**
 * Represents the contextual ribbon shown when a terminal tab is active. The session, clipboard,
 * actions and locations commands drive the active terminal through the {@link TerminalCommands}
 * registry; the view toggles and the AI group are static scaffolding.
 */
@Component({
  selector: 'app-terminal-ribbon',
  imports: [RibbonStripGroup, RibbonStripColumn, RibbonStripButton, RibbonStripCheck],
  templateUrl: './terminal-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the terminal commands registry the ribbon actions are routed through.
   */
  private readonly commands: TerminalCommands = inject(TerminalCommands);

  /**
   * Clears the active terminal's screen.
   */
  protected onClear(): void {
    this.commands.clear();
  }

  /**
   * Destroys and respawns the active terminal, keeping its identifier.
   */
  protected onRestart(): void {
    this.commands.restart();
  }

  /**
   * Copies the active terminal's buffer to the clipboard, then clears it.
   */
  protected onCut(): void {
    this.commands.cut();
  }

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
   * Runs a directory listing in the active terminal.
   */
  protected onList(): void {
    this.commands.list();
  }

  /**
   * Runs a detailed directory listing in the active terminal.
   */
  protected onListAll(): void {
    this.commands.listAll();
  }

  /**
   * Opens the active terminal's working directory in the file manager.
   */
  protected onOpen(): void {
    this.commands.open();
  }

  /**
   * Changes the active terminal's directory to the user's home directory.
   */
  protected onHome(): void {
    this.commands.home();
  }

  /**
   * Changes the active terminal's directory to the file-system root.
   */
  protected onRoot(): void {
    this.commands.root();
  }
}
