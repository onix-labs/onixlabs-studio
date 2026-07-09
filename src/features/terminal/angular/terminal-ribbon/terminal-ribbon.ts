import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripCheck } from '@shared/angular/components/ribbon-strip/ribbon-strip-check/ribbon-strip-check';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { ShellInfo } from '@shared/api/terminal-channels';
import { TerminalAgents } from '@features/terminal/angular/terminal-agents/terminal-agents';
import { TerminalCommands } from '@features/terminal/angular/terminal-commands/terminal-commands';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Represents the contextual ribbon shown when a terminal tab is active. The session, clipboard,
 * actions and locations commands drive the active terminal through the {@link TerminalCommands}
 * registry; the AI group's Agent button toggles the active terminal's docked agent panel; the View
 * group's Scroll Lock check freezes the active terminal's viewport as output streams in.
 */
@Component({
  selector: 'app-terminal-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripCheck,
    RibbonStripField,
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
   * Holds the installed-shells provider backing the shell picker.
   */
  private readonly terminalShells: TerminalShells = inject(TerminalShells);

  /**
   * Gets a value indicating whether the active terminal has scroll lock engaged.
   */
  protected readonly scrollLocked: Signal<boolean> = this.commands.scrollLocked;

  /**
   * Gets the display names of the installed shells, offered by the shell picker.
   */
  protected readonly shellOptions: Signal<readonly string[]> = computed((): readonly string[] =>
    this.terminalShells.shells().map((shell: ShellInfo): string => shell.name),
  );

  /**
   * Gets the display name of the active terminal's current shell, selecting it in the picker; empty
   * when no terminal is active or its shell is not yet known.
   */
  protected readonly currentShellName: Signal<string> = computed((): string => {
    const shellPath: string | undefined = this.commands.currentShell();
    return shellPath === undefined ? '' : this.terminalShells.nameOf(shellPath);
  });

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

  /**
   * Sets scroll lock on the active terminal.
   * @param value The new checked state emitted by the Scroll Lock check.
   */
  protected onScrollLock(value: boolean): void {
    this.commands.setScrollLock(value);
  }

  /**
   * Switches the active terminal to the shell chosen in the picker, respawning its session.
   * @param name The display name of the chosen shell.
   */
  protected onShellChange(name: string): void {
    const chosen: ShellInfo | undefined = this.terminalShells
      .shells()
      .find((shell: ShellInfo): boolean => shell.name === name);
    if (chosen !== undefined) {
      this.commands.setShell(chosen.path);
    }
  }
}
