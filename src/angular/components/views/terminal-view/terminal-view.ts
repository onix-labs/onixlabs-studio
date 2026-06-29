import {
  ChangeDetectionStrategy,
  Component,
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
import { Studio } from '@shared/angular/services/studio/studio';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TerminalAgents } from '../../../services/terminal-agents/terminal-agents';
import {
  TerminalCommandHandler,
  TerminalCommands,
} from '../../../services/terminal-commands/terminal-commands';
import { TerminalStatus } from '../../../services/terminal-status/terminal-status';
import { TerminalAgentPanel } from './terminal-agent-panel/terminal-agent-panel';

/**
 * Holds the interval, in milliseconds, between polls for the terminal's working directory.
 */
const CWD_POLL_INTERVAL_MS: number = 1500;

/**
 * Holds the minimum size, in pixels, of the docked agent pane.
 */
const MIN_AGENT_SIZE: number = 240;

/**
 * Holds the maximum size, in pixels, of the docked agent pane.
 */
const MAX_AGENT_SIZE: number = 900;

/**
 * Holds the initial size, in pixels, of the docked agent pane.
 */
const DEFAULT_AGENT_SIZE: number = 360;

/**
 * Represents the terminal feature view: the shared {@link Terminal} pane in the main area with an
 * optional docked agent panel beside it. It owns the terminal-tab concerns the bare pane does not —
 * the ribbon command handler, the working-directory status segment, the tab title, and the agent
 * panel and its resize splitter — driving the pane through its imperative API.
 */
@Component({
  selector: 'app-terminal-view',
  imports: [Terminal, TerminalAgentPanel],
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
   * Holds the Studio bridge used to open the working directory in the OS file manager.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the docked agent-panel state for terminal tabs.
   */
  private readonly terminalAgents: TerminalAgents = inject(TerminalAgents);

  /**
   * Holds the shared terminal pane this view drives, or undefined before the view initialises.
   */
  private readonly terminal: Signal<Terminal | undefined> = viewChild<Terminal>(Terminal);

  /**
   * Holds the size, in pixels, of the docked agent pane.
   */
  private readonly agentSizeSignal: WritableSignal<number> = signal<number>(DEFAULT_AGENT_SIZE);

  /**
   * Holds the splitter drag origin (pointer coordinate at drag start).
   */
  private dragOrigin: number = 0;

  /**
   * Holds the pane size at the start of a splitter drag.
   */
  private dragOriginSize: number = 0;

  /**
   * Holds a value indicating whether the pane's PTY session is ready.
   */
  private readonly paneReady: WritableSignal<boolean> = signal<boolean>(false);

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
  public readonly terminalId: InputSignal<string> = input.required<string>();

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
    // Poll the working directory and publish it to the status strip while the terminal is active.
    effect((): void => {
      if (this.isActive() && this.paneReady()) {
        this.startCwdPolling();
      } else {
        this.stopCwdPolling();
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
        this.commandHandler = null;
      }
    });

    // Re-fit the pane whenever the docked agent panel opens/closes or is resized, since the terminal's
    // width changes. The fit is deferred so the layout change has applied to the DOM first.
    effect((): void => {
      this.agentVisible();
      this.agentSize();
      const pane: Terminal | undefined = this.terminal();
      if (pane === undefined) {
        return;
      }
      setTimeout((): void => pane.handleResize(), 0);
    });
  }

  /**
   * Unregisters the command handler and tears down the agent panel state on destroy. The pane manages
   * its own xterm and PTY lifecycle.
   */
  public ngOnDestroy(): void {
    if (this.commandHandler !== null) {
      this.terminalCommands.unregister(this.commandHandler);
      this.commandHandler = null;
    }
    this.stopCwdPolling();
    this.terminalAgents.remove(this.terminalId());
  }

  /**
   * Records that the pane's PTY session is ready and forwards the ready signal.
   */
  protected onPaneReady(): void {
    this.paneReady.set(true);
    this.ready.emit();
  }

  /**
   * Renames the owning tab when the shell sets the terminal title.
   * @param title The new terminal title.
   */
  protected onTitleChange(title: string): void {
    this.tabsService.rename(this.terminalId(), title);
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
    return this.terminalAgents.isMounted(this.terminalId());
  }

  /**
   * Gets a value indicating whether the docked agent panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected agentVisible(): boolean {
    return this.terminalAgents.isVisible(this.terminalId());
  }

  /**
   * Gets the size, in pixels, of the docked agent pane.
   * @returns Returns the agent pane size.
   */
  protected agentSize(): number {
    return this.agentSizeSignal();
  }

  /**
   * Begins a splitter drag that resizes the docked agent pane. The agent always docks to the right,
   * so the drag is horizontal: moving the splitter left widens the agent.
   * @param event The originating pointer event.
   */
  protected onAgentSplitterDown(event: MouseEvent): void {
    event.preventDefault();
    this.dragOrigin = event.clientX;
    this.dragOriginSize = this.agentSizeSignal();

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = this.dragOrigin - move.clientX;
      const next: number = Math.min(
        MAX_AGENT_SIZE,
        Math.max(MIN_AGENT_SIZE, this.dragOriginSize + delta),
      );
      this.agentSizeSignal.set(next);
    };
    const onUp: () => void = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /**
   * Registers this terminal's command handler so the ribbon's copy/paste/clear/nuke actions act on
   * the pane while it is active.
   */
  private registerCommandHandler(): void {
    this.commandHandler = {
      clear: (): void => {
        this.terminal()?.clear();
      },
      restart: (): void => {
        void this.terminal()?.restart();
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
    };
    this.terminalCommands.register(this.commandHandler);
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
      await this.studio.openPath(cwd);
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
   * Stops polling the working directory and clears the published status segment.
   */
  private stopCwdPolling(): void {
    if (this.cwdPollHandle !== null) {
      clearInterval(this.cwdPollHandle);
      this.cwdPollHandle = null;
    }
    this.terminalStatus.setCwd(null);
  }

  /**
   * Asks the pane for the PTY's working directory and publishes it to the status strip while this
   * terminal remains active.
   */
  private async pollCwd(): Promise<void> {
    const pane: Terminal | undefined = this.terminal();
    if (pane === undefined || pane.isExited) {
      return;
    }
    const cwd: string | null = await pane.getCwd();
    if (this.isActive()) {
      this.terminalStatus.setCwd(cwd);
    }
  }
}
