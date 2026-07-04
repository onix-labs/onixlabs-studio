import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripCheck } from '@shared/angular/components/ribbon-strip/ribbon-strip-check/ribbon-strip-check';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { TerminalAgents } from '@features/terminal/angular/terminal-agents/terminal-agents';
import { TerminalCommands } from '@features/terminal/angular/terminal-commands/terminal-commands';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Represents the contextual ribbon shown when a terminal tab is active. The session, clipboard,
 * actions and locations commands drive the active terminal through the {@link TerminalCommands}
 * registry; the AI group's Agent button toggles the active terminal's docked agent panel; the view
 * toggles are static scaffolding.
 */
@Component({
  selector: 'app-terminal-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripCheck,
  ],
  templateUrl: './terminal-ribbon.html',
  hostDirectives: [RibbonHost],
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
   * Holds the tab registry, used to resolve the active terminal tab for the agent toggle.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the docked agent-panel state for terminal tabs.
   */
  private readonly terminalAgents: TerminalAgents = inject(TerminalAgents);

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

  /**
   * Toggles the active terminal tab's docked agent panel.
   */
  protected onAgent(): void {
    const id: string | undefined = this.tabs.activeTabId();
    if (id !== undefined) {
      this.terminalAgents.toggle(id);
    }
  }
}
