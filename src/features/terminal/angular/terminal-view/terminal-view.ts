import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { FindPanel } from '@shared/angular/components/find-panel/find-panel';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelArrangements } from '@shared/angular/components/panel-layout/panel-arrangements';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { Settings } from '@shared/angular/services/settings/settings';
import { Shell } from '@shared/angular/services/shell/shell';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TerminalAgents } from '@features/terminal/angular/terminal-agents/terminal-agents';
import {
  TerminalCommandHandler,
  TerminalCommands,
} from '@features/terminal/angular/terminal-commands/terminal-commands';
import { TerminalFindAdapter } from '@features/terminal/angular/find/terminal-find-adapter';
import { TerminalStatus } from '@features/terminal/angular/terminal-status/terminal-status';
import { TerminalAgentPanel } from './terminal-agent-panel/terminal-agent-panel';

/**
 * Holds the interval, in milliseconds, between polls for the terminal's working directory.
 */
const CWD_POLL_INTERVAL_MS: number = 1500;

/**
 * Holds the maximum length of the working-directory tab title before it is truncated from the left,
 * keeping the tail (the deepest directories) with a leading ellipsis.
 */
const MAX_TAB_TITLE_LENGTH: number = 24;

/**
 * Represents the terminal feature view: the shared {@link Terminal} pane in the main area with an
 * optional docked agent panel beside it. It owns the terminal-tab concerns the bare pane does not —
 * the ribbon command handler, the shell (terminal type) status segment, the working-directory tab
 * title, and the agent panel — driving the pane through its imperative API.
 */
@Component({
  selector: 'app-terminal-view',
  imports: [PanelLayout, Panel, Terminal, TerminalAgentPanel, FindPanel],
  templateUrl: './terminal-view.html',
  styleUrl: './terminal-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalView implements OnDestroy {
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
   * Holds the docked agent-panel state for terminal tabs.
   */
  private readonly terminalAgents: TerminalAgents = inject(TerminalAgents);

  /**
   * Holds the shared terminal pane this view drives, or undefined before the view initialises.
   */
  private readonly terminal: Signal<Terminal | undefined> = viewChild<Terminal>(Terminal);

  /**
   * Holds the persisted panel arrangements, observed so the pane re-fits when the agent panel
   * moves or resizes.
   */
  private readonly arrangements: PanelArrangements = inject(PanelArrangements);

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
   * Holds the last working-directory title applied to the tab, so a poll that finds an unchanged
   * directory does not re-rename the tab.
   */
  private lastTabTitle: string | null = null;

  /**
   * Holds a value indicating whether the find panel is shown over the terminal.
   */
  protected readonly findVisible: WritableSignal<boolean> = signal<boolean>(false);

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
   * Holds the handle for the recurring working-directory poll, or null when not polling.
   */
  private cwdPollHandle: ReturnType<typeof setInterval> | null = null;

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
   * Emits once the PTY session is created and its I/O is wired up.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Initializes a new instance of the {@link TerminalView} class, wiring the active-tab effects.
   */
  public constructor() {
    // Poll the working directory and reflect it in the tab title while the terminal is active.
    effect((): void => {
      if (this.isActive() && this.paneReady()) {
        this.startCwdPolling();
      } else {
        this.stopCwdPolling();
      }
    });

    // Publish the shell (terminal type) to the status strip while the terminal is active, clearing it
    // when another view takes over.
    effect((): void => {
      const active: boolean = this.isActive() && this.paneReady();
      this.terminalStatus.setShell(active ? this.currentShell() : null);
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

    // Re-fit the pane whenever the docked agent panel opens/closes, moves edge or is resized, since
    // the terminal's extent changes. The fit is deferred so the layout change has applied to the DOM
    // first.
    effect((): void => {
      this.agentVisible();
      this.arrangements.arrangement('terminal')();
      const pane: Terminal | undefined = this.terminal();
      if (pane === undefined) {
        return;
      }
      setTimeout((): void => pane.handleResize(), 0);
    });

    // Apply scroll lock to the pane whenever it changes, and once the pane becomes available.
    effect((): void => {
      const locked: boolean = this.scrollLocked();
      this.terminal()?.setScrollLocked(locked);
    });
  }

  /**
   * Unregisters the command handler and tears down the agent panel state on destroy. The pane manages
   * its own xterm and PTY lifecycle.
   */
  public ngOnDestroy(): void {
    if (this.commandHandler !== null) {
      this.terminalCommands.unregister(this.commandHandler);
      this.keybindings.forget(this.tabId());
      this.commandHandler = null;
    }
    this.stopCwdPolling();
    this.terminalAgents.remove(this.tabId());
  }

  /**
   * Records that the pane's PTY session is ready and forwards the ready signal.
   */
  protected onPaneReady(): void {
    this.paneReady.set(true);
    this.ready.emit();
  }

  /**
   * Records the shell the pane reports it is running, deriving its display name for the status strip.
   * @param shell The spawned shell executable path.
   */
  protected onShellChange(shell: string): void {
    const base: string = shell.split(/[\\/]/).pop() ?? shell;
    this.currentShell.set(base.replace(/\.[^.]+$/, ''));
  }

  /**
   * Stops the working-directory poll when the PTY process exits.
   */
  protected onExited(): void {
    this.stopCwdPolling();
  }

  /**
   * Gets a value indicating whether the docked agent panel is mounted.
   * @returns Returns true when the panel has been shown at least once.
   */
  protected agentMounted(): boolean {
    return this.terminalAgents.isMounted(this.tabId());
  }

  /**
   * Gets a value indicating whether the docked agent panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected agentVisible(): boolean {
    return this.terminalAgents.isVisible(this.tabId());
  }

  /**
   * Registers this terminal's command handler so the ribbon's copy/paste/clear/nuke actions act on
   * the pane while it is active.
   */
  private registerCommandHandler(): void {
    this.commandHandler = {
      scrollLocked: this.scrollLocked.asReadonly(),
      setScrollLock: (value: boolean): void => this.scrollLocked.set(value),
      scrollToBottom: (): void => {
        this.terminal()?.scrollToBottom();
      },
      clear: (): void => {
        this.terminal()?.clear();
      },
      restart: (): void => {
        void this.terminal()?.restart();
      },
      newSession: (shell?: string): void => {
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
      list: (): void => {
        this.terminal()?.runCommand('ls');
      },
      listAll: (): void => {
        this.terminal()?.runCommand('ls -la');
      },
      open: (): void => {
        void this.openDirectory();
      },
      home: (): void => {
        this.terminal()?.runCommand('cd ~');
      },
      root: (): void => {
        this.terminal()?.runCommand('cd /');
      },
      find: (): void => this.showFind(),
    };
    this.terminalCommands.register(this.commandHandler);
    this.registerKeybindings();
  }

  /**
   * Shows the find panel over the terminal — used by the ribbon's Find command and the pane's find
   * chord, both of which should open rather than toggle it.
   */
  protected showFind(): void {
    this.findVisible.set(true);
  }

  /**
   * Hides the find panel when the shared panel asks to be dismissed.
   */
  protected onFindClosed(): void {
    this.findVisible.set(false);
  }

  /**
   * Registers the terminal's keyboard accelerators for the active tab. Only Mod+Shift chords are used:
   * a bare Mod (Ctrl on Windows and Linux) collides with the shell's own control codes, whereas
   * Mod+Shift chords are never sent to the pty, so they compose safely with the terminal's input.
   */
  private registerKeybindings(): void {
    this.keybindings.register(this.tabId(), [
      { chord: 'Mod+Shift+K', command: (): void => this.terminalCommands.clear() },
    ]);
  }

  /**
   * Opens the terminal's working directory in the operating system's file manager.
   */
  private async openDirectory(): Promise<void> {
    const pane: Terminal | undefined = this.terminal();
    if (pane === undefined) {
      return;
    }
    const cwd: string | null = await pane.getCwd();
    if (cwd !== null) {
      await this.shell.openPath(cwd);
    }
    pane.focus();
  }

  /**
   * Starts polling the PTY's working directory and publishing it to the status strip. Does nothing
   * when a poll is already running.
   */
  private startCwdPolling(): void {
    if (this.cwdPollHandle !== null) {
      return;
    }
    void this.pollCwd();
    this.cwdPollHandle = setInterval((): void => void this.pollCwd(), CWD_POLL_INTERVAL_MS);
  }

  /**
   * Stops polling the working directory.
   */
  private stopCwdPolling(): void {
    if (this.cwdPollHandle !== null) {
      clearInterval(this.cwdPollHandle);
      this.cwdPollHandle = null;
    }
  }

  /**
   * Asks the pane for the PTY's working directory and reflects it in the tab title while this terminal
   * remains active, skipping the rename when the directory is unchanged.
   */
  private async pollCwd(): Promise<void> {
    const pane: Terminal | undefined = this.terminal();
    if (pane === undefined || pane.isExited) {
      return;
    }
    const cwd: string | null = await pane.getCwd();
    if (cwd === null || !this.isActive()) {
      return;
    }
    const title: string = this.formatCwdTitle(cwd);
    if (title !== this.lastTabTitle) {
      this.lastTabTitle = title;
      this.tabsService.rename(this.tabId(), title);
    }
  }

  /**
   * Formats a working directory for the tab title: the home directory is abbreviated to `~`, and an
   * over-long path is truncated from the left so the tail (the deepest directories) stays visible
   * behind a leading ellipsis.
   * @param cwd The absolute working directory.
   * @returns Returns the formatted tab title.
   */
  private formatCwdTitle(cwd: string): string {
    const home: string | undefined = window.host?.homeDir;
    const abbreviated: string =
      home !== undefined && home.length > 0 && (cwd === home || cwd.startsWith(`${home}/`))
        ? `~${cwd.slice(home.length)}`
        : cwd;
    return abbreviated.length > MAX_TAB_TITLE_LENGTH
      ? `…${abbreviated.slice(abbreviated.length - MAX_TAB_TITLE_LENGTH + 1)}`
      : abbreviated;
  }
}
