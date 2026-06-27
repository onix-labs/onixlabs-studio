import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
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
import { FitAddon } from '@xterm/addon-fit';
import { ITheme, Terminal } from '@xterm/xterm';
import { TerminalCreateResult } from '../../../../shared/studio-api';
import { TerminalBridge } from '../../../services/terminal-bridge/terminal-bridge';
import { Studio } from '../../../services/studio/studio';
import { Tabs } from '../../../services/tabs/tabs';
import { TerminalAgents } from '../../../services/terminal-agents/terminal-agents';
import {
  TerminalCommandHandler,
  TerminalCommands,
} from '../../../services/terminal-commands/terminal-commands';
import { TerminalStatus } from '../../../services/terminal-status/terminal-status';
import { Terminals } from '../../../services/terminals/terminals';
import { AccentColor, Theme } from '../../../services/theme/theme';
import { TerminalAgentPanel } from './terminal-agent-panel/terminal-agent-panel';

/**
 * Holds the delay, in milliseconds, used to defer initial focus until the view has settled.
 */
const FOCUS_DELAY_MS: number = 0;

/**
 * Holds the interval, in milliseconds, between polls for the terminal's working directory.
 */
const CWD_POLL_INTERVAL_MS: number = 1500;

/**
 * Holds the opacity applied to the accent colour when used as the terminal's selection background.
 */
const SELECTION_ALPHA: number = 0.3;

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
 * Represents the terminal view: an xterm.js instance wired to a main-process node-pty session
 * through the {@link TerminalBridge}. The session is kept alive while the tab is hidden; on
 * re-activation the terminal is re-fitted and focused.
 */
@Component({
  selector: 'app-terminal-view',
  imports: [TerminalAgentPanel],
  templateUrl: './terminal-view.html',
  styleUrl: './terminal-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalView implements AfterViewInit, OnDestroy {
  /**
   * Holds the terminal bridge used to manage the PTY session lifecycle and I/O.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the tab registry used to rename the owning tab when the shell sets the terminal title.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the theme service used to keep the terminal colours in sync with the application theme.
   */
  private readonly themeService: Theme = inject(Theme);

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
   * Holds the registry this terminal registers its output handle with, so the terminal agent can read
   * its on-screen output by id.
   */
  private readonly terminals: Terminals = inject(Terminals);

  /**
   * Holds the docked agent-panel state for terminal tabs.
   */
  private readonly terminalAgents: TerminalAgents = inject(TerminalAgents);

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
   * Gets the terminal/tab identifier. Must be unique per terminal.
   */
  public readonly terminalId: InputSignal<string> = input.required<string>();

  /**
   * Gets the working directory the terminal's shell starts in, or undefined to use the default (the
   * user's home directory). Read once when the session is created.
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
   * Holds the container element that hosts the xterm canvas.
   */
  private readonly container: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('container');

  /**
   * Holds a value indicating whether the xterm instance and PTY session are initialised.
   */
  protected readonly terminalReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the xterm instance, or null before initialisation.
   */
  protected xterm: Terminal | null = null;

  /**
   * Holds the fit addon used to size the terminal to its container.
   */
  private fitAddon: FitAddon | null = null;

  /**
   * Holds the observer that re-fits the terminal when its container resizes.
   */
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Holds the function that removes the PTY data listener, or null when not subscribed.
   */
  private cleanupOnData: (() => void) | null = null;

  /**
   * Holds the function that removes the PTY exit listener, or null when not subscribed.
   */
  private cleanupOnExit: (() => void) | null = null;

  /**
   * Holds the handle for the recurring working-directory poll, or null when not polling.
   */
  private cwdPollHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Holds the command handler registered with the ribbon while this terminal is active.
   */
  private commandHandler: TerminalCommandHandler | null = null;

  /**
   * Holds a value indicating whether the PTY process has exited.
   */
  protected hasExited: boolean = false;

  /**
   * Initializes a new instance of the {@link TerminalView} class, wiring the activation effect.
   */
  public constructor() {
    effect((): void => {
      const active: boolean = this.isActive();
      const ready: boolean = this.terminalReady();
      if (active && ready && this.xterm !== null && this.fitAddon !== null) {
        this.handleResize();
        this.xterm.focus();
      }
    });

    effect((): void => {
      const theme: ITheme = this.buildTheme();
      if (this.xterm !== null) {
        this.xterm.options.theme = theme;
      }
    });

    effect((): void => {
      if (this.isActive() && this.terminalReady()) {
        this.startCwdPolling();
      } else {
        this.stopCwdPolling();
      }
    });

    effect((): void => {
      if (this.isActive() && this.terminalReady()) {
        if (this.commandHandler === null) {
          this.registerCommandHandler();
        }
      } else if (this.commandHandler !== null) {
        this.terminalCommands.unregister(this.commandHandler);
        this.commandHandler = null;
      }
    });

    // Refit xterm whenever the docked agent panel opens/closes or is resized, since the terminal's
    // width changes. The fit is deferred so the layout change has applied to the DOM first.
    effect((): void => {
      this.agentVisible();
      this.agentSize();
      if (this.xterm === null || this.fitAddon === null) {
        return;
      }
      setTimeout((): void => this.handleResize(), 0);
    });
  }

  /**
   * Initialises the terminal once the view is ready.
   */
  public ngAfterViewInit(): void {
    void this.initialize();
  }

  /**
   * Tears down the xterm instance, listeners, and PTY session on destroy.
   */
  public ngOnDestroy(): void {
    if (this.commandHandler !== null) {
      this.terminalCommands.unregister(this.commandHandler);
      this.commandHandler = null;
    }
    this.cleanupOnData?.();
    this.cleanupOnExit?.();
    this.resizeObserver?.disconnect();
    this.stopCwdPolling();
    this.terminals.unregister(this.terminalId());
    this.terminalAgents.remove(this.terminalId());
    if (!this.hasExited) {
      void this.bridge.dispose(this.terminalId());
    }
    this.xterm?.dispose();
    this.xterm = null;
    this.fitAddon = null;
  }

  /**
   * Creates the xterm instance, starts the PTY session, and wires up bidirectional I/O.
   */
  private async initialize(): Promise<void> {
    if (!this.bridge.isElectron) {
      this.renderUnavailable();
      return;
    }

    const id: string = this.terminalId();
    const host: HTMLDivElement = this.container().nativeElement;

    const xterm: Terminal = new Terminal({
      fontFamily: '"JetBrains Mono", "Menlo", "Consolas", monospace',
      fontSize: 13,
      theme: this.buildTheme(),
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon: FitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host);
    this.xterm = xterm;
    this.fitAddon = fitAddon;

    fitAddon.fit();

    const result: TerminalCreateResult = await this.bridge.create({
      id,
      cols: xterm.cols,
      rows: xterm.rows,
      cwd: this.cwd(),
    });
    if (!result.success) {
      xterm.writeln(`\x1b[31mFailed to start terminal: ${result.error ?? 'unknown error'}\x1b[0m`);
      return;
    }

    this.cleanupOnData = this.bridge.onData((targetId: string, data: string): void => {
      if (targetId === id) {
        this.xterm?.write(data);
      }
    });

    this.cleanupOnExit = this.bridge.onExit((targetId: string, exitCode: number): void => {
      if (targetId !== id) {
        return;
      }
      this.hasExited = true;
      this.stopCwdPolling();
      this.xterm?.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`);
    });

    xterm.onData((data: string): void => {
      void this.bridge.write(id, data);
    });

    xterm.onTitleChange((title: string): void => {
      this.tabsService.rename(id, title);
    });

    this.resizeObserver = new ResizeObserver((): void => this.handleResize());
    this.resizeObserver.observe(host);

    // Register this terminal's output handle so the terminal agent can read its on-screen text by id.
    this.terminals.register(id, { readText: (): string => this.getBufferText() });

    setTimeout((): void => xterm.focus(), FOCUS_DELAY_MS);
    this.terminalReady.set(true);
    this.ready.emit();
  }

  /**
   * Re-fits the terminal to its container and notifies the PTY of the new size.
   */
  protected handleResize(): void {
    if (this.xterm === null || this.fitAddon === null) {
      return;
    }
    try {
      this.fitAddon.fit();
      void this.bridge.resize(this.terminalId(), this.xterm.cols, this.xterm.rows);
    } catch {
      // Fit can throw when the host has zero size (e.g. while hidden); ignore.
    }
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
   * it while it is active.
   */
  private registerCommandHandler(): void {
    this.commandHandler = {
      clear: (): void => this.clearScreen(),
      restart: (): void => void this.restart(),
      cut: (): void => this.cutBuffer(),
      copy: (): void => this.copySelection(),
      paste: (): void => this.pasteClipboard(),
      list: (): void => this.runCommand('ls'),
      listAll: (): void => this.runCommand('ls -la'),
      open: (): void => void this.openDirectory(),
      home: (): void => this.runCommand('cd ~'),
      root: (): void => this.runCommand('cd /'),
    };
    this.terminalCommands.register(this.commandHandler);
  }

  /**
   * Writes a shell command (followed by a carriage return) to the terminal and returns focus to it.
   * @param command The command to run.
   */
  private runCommand(command: string): void {
    void this.bridge.write(this.terminalId(), `${command}\r`);
    this.xterm?.focus();
  }

  /**
   * Copies the whole buffer to the clipboard, then clears the screen.
   */
  private cutBuffer(): void {
    const xterm: Terminal | null = this.xterm;
    if (xterm === null) {
      return;
    }
    const text: string = this.getBufferText();
    if (text.length > 0) {
      void navigator.clipboard.writeText(text);
    }
    xterm.clear();
    xterm.focus();
  }

  /**
   * Opens the terminal's working directory in the operating system's file manager.
   */
  private async openDirectory(): Promise<void> {
    const cwd: string | null = await this.bridge.getCwd(this.terminalId());
    if (cwd !== null) {
      await this.studio.openPath(cwd);
    }
    this.xterm?.focus();
  }

  /**
   * Copies the current selection to the clipboard, falling back to the whole buffer when nothing is
   * selected.
   */
  private copySelection(): void {
    const xterm: Terminal | null = this.xterm;
    if (xterm === null) {
      return;
    }
    const selection: string = xterm.getSelection();
    const text: string = selection.length > 0 ? selection : this.getBufferText();
    if (text.length > 0) {
      void navigator.clipboard.writeText(text);
    }
    xterm.focus();
  }

  /**
   * Pastes the clipboard contents into the terminal's input stream.
   */
  private pasteClipboard(): void {
    const id: string = this.terminalId();
    void navigator.clipboard.readText().then((text: string): void => {
      if (text.length > 0) {
        void this.bridge.write(id, text);
      }
    });
    this.xterm?.focus();
  }

  /**
   * Clears the terminal screen.
   */
  private clearScreen(): void {
    this.xterm?.clear();
    this.xterm?.focus();
  }

  /**
   * Destroys the current xterm and PTY session and spawns a fresh one in its place, keeping the
   * terminal identifier. The session is disposed before the new one spawns so the main process does
   * not reuse the dying session.
   */
  private async restart(): Promise<void> {
    if (!this.bridge.isElectron) {
      return;
    }
    const id: string = this.terminalId();

    this.cleanupOnData?.();
    this.cleanupOnData = null;
    this.cleanupOnExit?.();
    this.cleanupOnExit = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopCwdPolling();
    this.terminalReady.set(false);

    if (!this.hasExited) {
      await this.bridge.dispose(id);
    }
    this.hasExited = false;

    this.xterm?.dispose();
    this.xterm = null;
    this.fitAddon = null;

    await this.initialize();
  }

  /**
   * Reads the full buffer of the terminal as plain text, with trailing blank lines removed.
   * @returns Returns the terminal buffer contents.
   */
  private getBufferText(): string {
    const xterm: Terminal | null = this.xterm;
    if (xterm === null) {
      return '';
    }
    const buffer: Terminal['buffer']['active'] = xterm.buffer.active;
    const lines: string[] = [];
    for (let index: number = 0; index < buffer.length; index++) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    }
    return lines.join('\n').replace(/\n+$/, '');
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
   * Asks the main process for the PTY's working directory and publishes it to the status strip while
   * this terminal remains active.
   */
  private async pollCwd(): Promise<void> {
    if (this.hasExited) {
      return;
    }
    const cwd: string | null = await this.bridge.getCwd(this.terminalId());
    if (this.isActive()) {
      this.terminalStatus.setCwd(cwd);
    }
  }

  /**
   * Builds the xterm theme from the application's palette primitives, keyed by the current resolved
   * mode and accent so the terminal stays in sync with the appearance settings.
   * @returns Returns the xterm theme.
   */
  private buildTheme(): ITheme {
    const styles: CSSStyleDeclaration = getComputedStyle(document.documentElement);
    const read: (name: string) => string = (name: string): string =>
      styles.getPropertyValue(name).trim();
    const dark: boolean = this.themeService.resolvedMode() === 'dark';
    const accent: AccentColor = this.themeService.accent();
    const light: string = read('--gray-100');
    const ink: string = read('--gray-900');
    return {
      background: dark ? ink : light,
      foreground: dark ? light : ink,
      cursor: read(`--accent-${accent}`),
      cursorAccent: dark ? ink : light,
      selectionBackground: `rgba(${read(`--accent-${accent}-rgb`)}, ${SELECTION_ALPHA})`,
    };
  }

  /**
   * Renders a fallback message when the terminal is not running inside Electron.
   */
  private renderUnavailable(): void {
    this.container().nativeElement.textContent =
      'Terminal is only available when running inside Electron.';
  }
}
