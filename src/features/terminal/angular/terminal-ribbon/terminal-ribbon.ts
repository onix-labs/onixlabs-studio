import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import {
  MENU_SEPARATOR,
  MenuContribution,
  MenuEntry,
} from '@shared/angular/services/app-menu/app-menu-model';
import { Log } from '@shared/angular/services/log/log';
import { ShellInfo } from '@shared/api/terminal-channels';
import { TerminalAgents } from '@features/terminal/angular/terminal-agents/terminal-agents';
import { TerminalCommands } from '@features/terminal/angular/terminal-commands/terminal-commands';
import {
  locationCommand,
  ShellFamily,
  TerminalListing,
  TerminalLocation,
} from '@features/terminal/angular/terminal-commands/shell-commands';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';

/**
 * Identifies the Restart entry in the Clear button's dropdown.
 */
const VARIANT_RESTART: string = 'restart';

/**
 * Describes one of the List button's further listings.
 */
interface ListingOption {
  /**
   * Gets the listing.
   */
  readonly listing: TerminalListing;

  /**
   * Gets the label shown for it.
   */
  readonly label: string;

  /**
   * Gets the icon shown beside it, if any.
   */
  readonly icon?: Icon;
}

/**
 * Describes one of the Home button's further locations.
 */
interface LocationOption {
  /**
   * Gets the location.
   */
  readonly location: TerminalLocation;

  /**
   * Gets the label shown for it.
   */
  readonly label: string;

  /**
   * Gets the icon shown beside it, if any.
   */
  readonly icon?: Icon;
}

/**
 * Holds the listings the List button's drop-down offers beside its own plain listing, in the order
 * people reach for them.
 */
const LISTING_OPTIONS: readonly ListingOption[] = [
  { listing: 'all', label: 'List All', icon: Icon.LIST_ALL },
  { listing: 'byTime', label: 'Sort by Time', icon: Icon.RECENT },
  { listing: 'bySize', label: 'Sort by Size', icon: Icon.SORT_BY_SIZE },
  { listing: 'folders', label: 'Folders Only', icon: Icon.FOLDER },
];

/**
 * Holds the locations the Home button's drop-down offers beside home itself.
 */
const LOCATION_OPTIONS: readonly LocationOption[] = [
  { location: 'root', label: 'Root', icon: Icon.ROOT },
  { location: 'up', label: 'Up One Level', icon: Icon.ARROW_UP },
  { location: 'previous', label: 'Previous Folder', icon: Icon.PREVIOUS_FOLDER },
  { location: 'desktop', label: 'Desktop', icon: Icon.DESKTOP },
  { location: 'documents', label: 'Documents', icon: Icon.DOCUMENTS },
  { location: 'downloads', label: 'Downloads', icon: Icon.DOWNLOAD },
];

/**
 * Represents the contextual ribbon shown when a terminal tab is active. The session, clipboard,
 * actions and locations commands drive the active terminal through the {@link TerminalCommands}
 * registry, which writes List's listings and Home's locations in the running shell's own command
 * (`ls -la` in zsh, `Get-ChildItem -Force` in PowerShell, `dir /a` in cmd); the Tools group's Agent button toggles the active terminal's docked agent panel; the View
 * group's Scroll Lock toggle freezes the active terminal's viewport as output streams in, which
 * disables Scroll (jump to newest output) while engaged.
 */
@Component({
  selector: 'app-terminal-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton, RibbonStripMenuButton],
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
   * Gets the List button's drop-down items: the further listings, each written in the active shell's
   * own command when chosen.
   */
  protected readonly listItems: readonly RibbonMenuItem[] = LISTING_OPTIONS.map(
    (option: ListingOption): RibbonMenuItem => ({
      id: option.listing,
      label: option.label,
      icon: option.icon,
    }),
  );

  /**
   * Gets the Home button's drop-down items: the further locations, with any the active shell has no
   * way to reach (a previous folder, in cmd and Windows PowerShell) shown but disabled.
   */
  protected readonly locationItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] =>
      LOCATION_OPTIONS.map((option: LocationOption): RibbonMenuItem => ({
        id: option.location,
        label: option.label,
        icon: option.icon,
        disabled: !this.canGoTo(option.location),
      })),
  );

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
            binding: 'terminal.new',
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
            label: 'Find',
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
          {
            label: 'List',
            items: [
              { id: 'terminal.list', label: 'List', run: (): void => this.onList() },
              ...LISTING_OPTIONS.map((option: ListingOption): MenuEntry => ({
                id: `terminal.list.${option.listing}`,
                label: option.label,
                run: (): void => this.onListing(option.listing),
              })),
            ],
          },
          {
            label: 'Go To',
            items: [
              { id: 'terminal.home', label: 'Home', run: (): void => this.onHome() },
              ...LOCATION_OPTIONS.map((option: LocationOption): MenuEntry => ({
                id: `terminal.goTo.${option.location}`,
                label: option.label,
                enabled: this.canGoTo(option.location),
                run: (): void => this.onLocation(option.location),
              })),
            ],
          },
          {
            id: 'terminal.open',
            label: OPEN_IN_FILE_SYSTEM_LABEL,
            run: (): void => this.onOpen(),
          },
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
   * Lists the active terminal's directory by name — the List button's primary action.
   */
  protected onList(): void {
    this.commands.list('names');
  }

  /**
   * Lists the active terminal's directory the way chosen from the List button's drop-down.
   * @param listing The chosen listing (the item's identifier).
   */
  protected onListing(listing: string): void {
    this.commands.list(listing as TerminalListing);
  }

  /**
   * Opens the active terminal's working directory in the file manager.
   */
  protected onOpen(): void {
    this.commands.open();
  }

  /**
   * Changes the active terminal's directory to the user's home directory — the Home button's primary
   * action.
   */
  protected onHome(): void {
    this.commands.goTo('home');
  }

  /**
   * Changes the active terminal's directory to the location chosen from the Home button's drop-down.
   * @param location The chosen location (the item's identifier).
   */
  protected onLocation(location: string): void {
    this.commands.goTo(location as TerminalLocation);
  }

  /**
   * Gets a value indicating whether the active terminal's shell can go to a location. With no active
   * terminal every location is offered, since there is no shell to rule one out.
   * @param location The location.
   * @returns Returns true when the shell has a command for it.
   */
  private canGoTo(location: TerminalLocation): boolean {
    const family: ShellFamily | null = this.commands.shellFamily();
    return family === null || locationCommand(family, location) !== null;
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
