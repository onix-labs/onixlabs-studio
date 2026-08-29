import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { Log } from '@shared/angular/services/log/log';
import { ShellInfo } from '@shared/api/terminal-channels';
import { TerminalAgents } from '@features/terminal/angular/terminal-agents/terminal-agents';
import { TerminalCommands } from '@features/terminal/angular/terminal-commands/terminal-commands';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Identifies the Restart entry in the Clear button's dropdown.
 */
const VARIANT_RESTART: string = 'restart';

/**
 * Represents the contextual ribbon shown when a terminal tab is active. The session, clipboard,
 * actions and locations commands drive the active terminal through the {@link TerminalCommands}
 * registry; the Tools group's Agent button toggles the active terminal's docked agent panel; the View
 * group's Scroll Lock toggle freezes the active terminal's viewport as output streams in, which
 * disables Scroll (jump to newest output) while engaged.
 */
@Component({
  selector: 'app-terminal-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripMenuButton,
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
   * Holds the structured logger for ribbon actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets a value indicating whether the active terminal has scroll lock engaged.
   */
  protected readonly scrollLocked: Signal<boolean> = this.commands.scrollLocked;

  /**
   * Contributes this tab's menu while the terminal ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'terminal',
    (): readonly MenuContribution[] => [
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'terminal.new',
            label: 'New Terminal',
            accelerator: 'CmdOrCtrl+Shift+T',
            run: (): void => this.onNew(),
          },
        ],
      },
      {
        id: 'edit',
        label: 'Edit',
        items: [
          // Cut, Copy and Paste are deliberately absent: the core contributes them once as native
          // roles, which Chromium routes to whatever holds focus, so xterm serves its own chord and a
          // text box docked beside it serves that one. A feature entry claiming the accelerator would
          // replace the core's and send every ⌘C on this tab to the terminal. The ribbon's clipboard
          // buttons remain, since pressing one is an explicit instruction to act on the terminal.
          {
            id: 'terminal.find',
            label: 'Find…',
            accelerator: 'CmdOrCtrl+F',
            run: (): void => this.onFind(),
          },
          { id: 'terminal.clear', label: 'Clear', run: (): void => this.onClear() },
        ],
      },
      {
        id: 'terminal',
        label: 'Terminal',
        items: [
          { id: 'terminal.list', label: 'List', run: (): void => this.onList() },
          { id: 'terminal.listAll', label: 'List All', run: (): void => this.onListAll() },
          MENU_SEPARATOR,
          { id: 'terminal.home', label: 'Go Home', run: (): void => this.onHome() },
          { id: 'terminal.root', label: 'Go to Workspace Root', run: (): void => this.onRoot() },
          { id: 'terminal.open', label: 'Reveal in Finder', run: (): void => this.onOpen() },
          MENU_SEPARATOR,
          {
            id: 'terminal.scrollLock',
            label: 'Scroll Lock',
            kind: 'checkbox',
            checked: this.scrollLocked(),
            run: (): void => this.onScrollLock(!this.scrollLocked()),
          },
          {
            id: 'terminal.scrollToBottom',
            label: 'Scroll to Bottom',
            run: (): void => this.onScrollToBottom(),
          },
          MENU_SEPARATOR,
          { id: 'terminal.agent', label: 'Ask the Agent', run: (): void => this.onAgent() },
        ],
      },
    ],
  );

  /**
   * Gets the New button's dropdown items: one per installed shell, each starting a fresh session under
   * that shell (the button's primary action uses the configured default instead).
   */
  protected readonly newShellItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] =>
      this.terminalShells
        .shells()
        .map((shell: ShellInfo): RibbonMenuItem => ({ id: shell.path, label: shell.name })),
  );

  /**
   * Gets the Clear button's dropdown items: Restart, which respawns the current shell.
   */
  protected readonly clearItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_RESTART, label: 'Restart', icon: Icon.RESTART },
  ];

  /**
   * Starts a fresh session on the active terminal using the configured default shell — the New
   * button's primary action.
   */
  protected onNew(): void {
    this.commands.newSession();
  }

  /**
   * Starts a fresh session on the active terminal under the shell chosen from the New button's
   * dropdown.
   * @param shellPath The chosen shell's executable path (the item's identifier).
   */
  protected onNewShell(shellPath: string): void {
    this.log.debug('terminal.ribbon', 'Shell selected from New menu', shellPath);
    this.commands.newSession(shellPath);
  }

  /**
   * Clears the active terminal's screen — the Clear button's primary action.
   */
  protected onClear(): void {
    this.commands.clear();
  }

  /**
   * Runs the action chosen from the Clear button's dropdown.
   * @param id The chosen variant's identifier.
   */
  protected onClearVariant(id: string): void {
    if (id === VARIANT_RESTART) {
      this.commands.restart();
    }
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
      this.log.info('terminal.ribbon', 'Toggled terminal agent panel', id);
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
   * Scrolls the active terminal to the newest output at the bottom of the buffer.
   */
  protected onScrollToBottom(): void {
    this.commands.scrollToBottom();
  }

  /**
   * Opens the find panel over the active terminal to search its buffer.
   */
  protected onFind(): void {
    this.commands.find();
  }
}
