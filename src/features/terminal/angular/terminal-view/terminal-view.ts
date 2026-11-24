import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Terminal, TerminalExit } from '@shared/angular/components/terminal/terminal';
import { closesOnShellExit } from '@shared/angular/services/terminal-close-guard/terminal-close-guard';
import { FindPanel } from '@shared/angular/components/find-panel/find-panel';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { DockTemplatePanel } from '@shared/angular/components/dock-layout/dock-template-panel/dock-template-panel';
import { Icon } from '@shared/angular/icons/icon';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import {
  AgentHostRegistrar,
  createAgentHostRegistrar,
} from '@shared/angular/services/agent-hosts/agent-host-registration';
import { dockProviders } from '@shared/angular/services/dock-layout/dock-providers';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { Shell } from '@shared/angular/services/shell/shell';
import { Studio } from '@shared/angular/services/studio/studio';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  TerminalCommandHandler,
  TerminalCommands,
} from '@features/terminal/angular/terminal-commands/terminal-commands';
import {
  listCommand,
  locationCommand,
  ShellFamily,
  shellFamilyOf,
  TerminalListing,
  TerminalLocation,
} from '@features/terminal/angular/terminal-commands/shell-commands';
import { TerminalFindAdapter } from '@features/terminal/angular/find/terminal-find-adapter';
import {
  TERMINAL_AGENT_PANEL_ID,
  TERMINAL_DOCK_BLUEPRINT,
  TERMINAL_FIND_PANEL_ID,
  TERMINAL_PANEL_ID,
} from '@features/terminal/angular/terminal-dock-blueprint';
import { TerminalStatus } from '@features/terminal/angular/terminal-status/terminal-status';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';

/**
 * Represents the terminal feature view: the shared {@link Terminal} pane in the main group of
 * a dock, with an agent panel and Find that dock around it. It owns the terminal-tab concerns the bare pane does not —
 * the ribbon command handler, the shell (terminal type) status segment, the terminal's address (its
 * prompt title) on the tab and status strip, the agent's conversation and the search — driving the pane through its
 * imperative API. The dock creates a panel afresh whenever it is shown or moved, which is why the
 * conversation and the search belong here. The address comes from the shell's own title (`user@host:~/path`): both the tab and
 * the status strip show it in full; the tab truncates it from the left in CSS (keeping the tail) when
 * squeezed, so the current directory stays visible.
 */
@Component({
  selector: 'app-terminal-view',
  imports: [AgentConversationPanel, DockContainer, DockTemplatePanel, FindPanel, Terminal],
  templateUrl: './terminal-view.html',
  styleUrl: './terminal-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    // One per terminal tab: the status strip reads this view's own context through its injector.
    TerminalStatus,
    ...dockProviders(TERMINAL_DOCK_BLUEPRINT),
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'terminal' },
  ],
})
export class TerminalView implements OnInit, OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the identifier of the terminal's own panel.
   */
  protected readonly terminalPanel: string = TERMINAL_PANEL_ID;

  /**
   * Gets the identifier of the agent panel.
   */
  protected readonly agentPanel: string = TERMINAL_AGENT_PANEL_ID;

  /**
   * Gets the identifier of the Find panel.
   */
  protected readonly findPanel: string = TERMINAL_FIND_PANEL_ID;

  /**
   * Holds the tab registry used to rename the owning tab when the shell sets the terminal title.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the terminal status service the working directory is published to.
   */
  private readonly terminalStatus: TerminalStatus = inject(TerminalStatus);

  /**
   * Holds the terminal commands registry the ribbon drives this terminal through.
   */
  private readonly terminalCommands: TerminalCommands = inject(TerminalCommands);

  /**
   * Holds the application keybinding router this view registers its accelerators with while active.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the shell client used to open the working directory in the OS file manager.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the settings service supplying the default shell for a new terminal.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the host bridge, read for the platform whose usual shell stands in before the pane reports
   * the one it spawned.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the dock's layout, which knows whether a panel is open.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds what opens the dock's panels wherever they are.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the dock's tab context, carrying this tab's identity to the panels inside it.
   */
  private readonly tabContext: DockTabContext = inject(DockTabContext);

  /**
   * Holds the structured logger for terminal-view actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the shared terminal pane this view drives, or undefined before the view initialises.
   */
  private readonly terminal: Signal<Terminal | undefined> = viewChild<Terminal>(Terminal);

  /**
   * Holds a value indicating whether the pane's PTY session is ready.
   */
  private readonly paneReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether scroll lock is engaged on this terminal, surfaced to the ribbon through the command
   * handler and applied to the pane. Kept for the terminal's lifetime so it survives deactivation.
   */
  private readonly scrollLocked: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the shell (terminal type) this terminal is running, published to the status strip while
   * active. Set once the pane reports the spawned shell (including after a New session or restart).
   */
  private readonly currentShell: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the executable path of the shell the pane reports it spawned, or null until it does.
   */
  private readonly currentShellPath: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the command dialect of the running shell, which the ribbon's listings and locations are
   * written in.
   */
  private readonly shellFamily: Signal<ShellFamily> = computed((): ShellFamily =>
    shellFamilyOf(this.currentShellPath(), this.studio.platform),
  );

  /**
   * Holds the terminal's address — the shell's own prompt title (`user@host:~/path`) — published in
   * full to the status strip and left-truncated onto the tab. Null until the shell first sets a title.
   */
  private readonly currentTitle: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the last title applied to the tab, so an unchanged title does not re-rename the tab.
   */
  private lastTabTitle: string | null = null;

  /**
   * Holds the text searched for, for as long as Find is open.
   */
  protected readonly findText: WritableSignal<string> = signal<string>('');

  /**
   * Holds the find adapter that drives the shared find panel against this terminal's buffer. Replace is
   * unsupported (the buffer is read-only), so the panel shows find only.
   */
  protected readonly findAdapter: TerminalFindAdapter = new TerminalFindAdapter(
    (): Terminal | null => this.terminal() ?? null,
  );

  /**
   * Gets the default shell a new terminal starts with, taken from the persisted setting; an empty
   * setting means "use the main process's default", surfaced as undefined so the pane falls back.
   */
  protected readonly defaultShell: Signal<string | undefined> = computed((): string | undefined => {
    const configured: string = this.settings.get('terminal.defaultShell');
    return configured.length > 0 ? configured : undefined;
  });

  /**
   * Holds the command handler registered with the ribbon while this terminal is active.
   */
  private commandHandler: TerminalCommandHandler | null = null;

  /**
   * Gets the terminal/tab identifier. Must be unique per terminal.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets the working directory the terminal's shell starts in, or undefined to use the default.
   */
  public readonly cwd: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Publishes this view's injector so the shell's status strip can mount the terminal status
   * component inside it. Declared after {@link isActive}, whose signal it reads, and finalised in
   * {@link ngOnInit} once the tab id is readable.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Registers this tab's live agent with Mission Control and the requests inbox for the tab's whole
   * life, whether or not its panel is open. Finalised in {@link ngOnInit} once the tab id is readable.
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    surface: 'terminal',
  });

  /**
   * Emits once the PTY session is created and its I/O is wired up.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Initializes a new instance of the {@link TerminalView} class, wiring the active-tab effects.
   */
  public constructor() {
    // Keep this view's address (full prompt title) and shell (terminal type) current for its status
    // strip. Activation is not consulted: the strip mounts this view's status component only while
    // the view is active, and destroys it on tab switch, so an inactive terminal's address is never
    // on screen to go stale.
    effect((): void => {
      if (this.paneReady()) {
        this.terminalStatus.publish({
          address: this.currentTitle(),
          shell: this.currentShell(),
        });
      } else {
        this.terminalStatus.clear();
      }
    });

    // Register the ribbon command handler while the terminal is active so copy/paste/clear act on it.
    effect((): void => {
      if (this.isActive() && this.paneReady()) {
        if (this.commandHandler === null) {
          this.registerCommandHandler();
        }
      } else if (this.commandHandler !== null) {
        this.terminalCommands.unregister(this.commandHandler);
        this.keybindings.deactivate(this.tabId());
        this.commandHandler = null;
      }
    });

    // A closed Find forgets its search, however it was closed.
    effect((): void => {
      if (!this.dockReveal.isOpen(TERMINAL_FIND_PANEL_ID)) {
        untracked((): void => {
          this.findText.set('');
          this.findAdapter.clear();
        });
      }
    });

    // Apply scroll lock to the pane whenever it changes, and once the pane becomes available.
    effect((): void => {
      const locked: boolean = this.scrollLocked();
      this.terminal()?.setScrollLocked(locked);
    });
  }

  /**
   * Registers the view with what needs its tab's identity, once it is readable: the status strip, the
   * agent registries and the dock.
   */
  public ngOnInit(): void {
    this.tabContext.setTabId(this.tabId());
    this.agentHost.register(this.tabId());
    this.statusHost.register(this.tabId());
  }

  /**
   * Unregisters the command handler on destroy. The pane manages its own xterm and PTY lifecycle.
   */
  public ngOnDestroy(): void {
    if (this.commandHandler !== null) {
      this.terminalCommands.unregister(this.commandHandler);
      this.keybindings.forget(this.tabId());
      this.commandHandler = null;
    }
    this.log.info('terminal.view', 'Terminal closed', this.tabId());
  }

  /**
   * Records that the pane's PTY session is ready and forwards the ready signal.
   */
  protected onPaneReady(): void {
    this.paneReady.set(true);
    this.ready.emit();
    this.log.info('terminal.view', 'Terminal PTY session ready', this.tabId());
  }

  /**
   * Records the shell the pane reports it is running, deriving its display name for the status strip.
   * @param shell The spawned shell executable path.
   */
  protected onShellChange(shell: string): void {
    const base: string = shell.split(/[\\/]/).pop() ?? shell;
    const name: string = base.replace(/\.[^.]+$/, '');
    this.currentShell.set(name);
    this.currentShellPath.set(shell);
    this.log.debug('terminal.view', 'Terminal shell reported', {
      tabId: this.tabId(),
      shell: name,
    });
  }

  /**
   * Closes the tab when its shell exits and When the Shell Exits says to. The shell has ended, so
   * there is nothing left running to ask about.
   * @param exit The code the shell exited with, and the signal that ended it.
   */
  protected onExited(exit: TerminalExit): void {
    if (closesOnShellExit(this.settings.get('terminal.onShellExit'), exit.code, exit.signal)) {
      this.log.info('terminal.view', 'Closing the tab: the shell exited', this.tabId());
      this.tabsService.close(this.tabId());
    }
  }

  /**
   * Records the shell's prompt title as the terminal's address: the full title feeds the status strip
   * (while active) and renames the tab. The tab itself truncates the title from the left in CSS
   * (keeping the tail — the current directory) when it is too narrow. A blank title is ignored so the
   * tab keeps its last meaningful name.
   * @param title The title the shell set (e.g. `user@host:~/path`).
   */
  protected onTitleChange(title: string): void {
    const trimmed: string = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.currentTitle.set(trimmed);
    if (trimmed !== this.lastTabTitle) {
      this.lastTabTitle = trimmed;
      this.tabsService.rename(this.tabId(), trimmed);
    }
  }

  /**
   * Registers this terminal's command handler so the ribbon's copy/paste/clear/nuke actions act on
   * the pane while it is active.
   */
  private registerCommandHandler(): void {
    this.commandHandler = {
      scrollLocked: this.scrollLocked.asReadonly(),
      shellFamily: this.shellFamily,
      setScrollLock: (value: boolean): void => this.scrollLocked.set(value),
      scrollToBottom: (): void => {
        this.terminal()?.scrollToBottom();
      },
      clear: (): void => {
        this.log.info('terminal.view', 'Terminal cleared', this.tabId());
        this.terminal()?.clear();
      },
      restart: (): void => {
        this.log.info('terminal.view', 'Terminal session restarted', this.tabId());
        void this.terminal()?.restart();
      },
      newSession: (shell?: string): void => {
        this.log.info('terminal.view', 'New terminal session spawned', {
          tabId: this.tabId(),
          shell: shell ?? '(default)',
        });
        void this.terminal()?.newSession(shell);
      },
      cut: (): void => {
        this.terminal()?.cut();
      },
      copy: (): void => {
        this.terminal()?.copy();
      },
      paste: (): void => {
        this.terminal()?.paste();
      },
      list: (listing: TerminalListing): void => {
        this.terminal()?.runCommand(listCommand(this.shellFamily(), listing));
      },
      open: (): void => {
        void this.openDirectory();
      },
      goTo: (location: TerminalLocation): void => this.goTo(location),
      find: (): void => this.showFind(),
      toggleAgent: (): void => this.dockReveal.toggle(TERMINAL_AGENT_PANEL_ID),
    };
    this.terminalCommands.register(this.commandHandler);
    this.registerKeybindings();
  }

  /**
   * Shows the find panel beside the terminal — used by the ribbon's Find command and the pane's find
   * chord, both of which should open rather than toggle it.
   */
  protected showFind(): void {
    this.dockReveal.open(TERMINAL_FIND_PANEL_ID);
    this.log.info('terminal.view', 'Terminal find panel opened', this.tabId());
  }

  /**
   * Closes the find panel when it asks to be dismissed.
   */
  protected onFindClosed(): void {
    void this.dockState.requestClose(TERMINAL_FIND_PANEL_ID);
  }

  /**
   * Registers the terminal's keyboard accelerators for the active tab. Only Mod+Shift chords are used:
   * a bare Mod (Ctrl on Windows and Linux) collides with the shell's own control codes, whereas
   * Mod+Shift chords are never sent to the pty, so they compose safely with the terminal's input.
   */
  private registerKeybindings(): void {
    this.keybindings.register(this.tabId(), [
      { id: 'terminal.clear', command: (): void => this.terminalCommands.clear() },
    ]);
  }

  /**
   * Changes the terminal's working directory to the given location, in the running shell's own
   * command; a location the shell cannot reach (a previous directory in cmd) is ignored.
   * @param location The location wanted.
   */
  private goTo(location: TerminalLocation): void {
    const family: ShellFamily = this.shellFamily();
    const command: string | null = locationCommand(family, location);
    if (command === null) {
      this.log.debug('terminal.view', 'The shell cannot go to that location', { family, location });
      return;
    }
    this.terminal()?.runCommand(command);
  }

  /**
   * Opens the terminal's working directory in the operating system's file manager. Where the platform
   * cannot report a process's working directory (Windows), the directory the terminal started in is
   * opened instead.
   */
  private async openDirectory(): Promise<void> {
    const pane: Terminal | undefined = this.terminal();
    if (pane === undefined) {
      return;
    }
    const cwd: string | null = (await pane.getCwd()) ?? this.cwd() ?? null;
    if (cwd !== null) {
      this.log.debug('terminal.view', 'Opening terminal directory in file manager', cwd);
      await this.shell.openPath(cwd);
    }
    pane.focus();
  }
}
