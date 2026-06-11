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
import { Tabs } from '../../../services/tabs/tabs';
import { TerminalStatus } from '../../../services/terminal-status/terminal-status';
import { AccentColor, Theme } from '../../../services/theme/theme';

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
 * Represents the terminal view: an xterm.js instance wired to a main-process node-pty session
 * through the {@link TerminalBridge}. The session is kept alive while the tab is hidden; on
 * re-activation the terminal is re-fitted and focused.
 */
@Component({
  selector: 'app-terminal-view',
  imports: [],
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
   * Gets the terminal/tab identifier. Must be unique per terminal.
   */
  public readonly terminalId: InputSignal<string> = input.required<string>();

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
    this.cleanupOnData?.();
    this.cleanupOnExit?.();
    this.resizeObserver?.disconnect();
    this.stopCwdPolling();
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
