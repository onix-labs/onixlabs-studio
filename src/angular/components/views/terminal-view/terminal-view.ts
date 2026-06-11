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

/**
 * Holds the placeholder theme applied to the xterm instance. The live light/dark theme is layered
 * on top of this by the appearance integration.
 */
const DEFAULT_THEME: ITheme = {
  background: '#212529',
  foreground: '#f8f9fa',
  cursor: '#f8f9fa',
};

/**
 * Holds the delay, in milliseconds, used to defer initial focus until the view has settled.
 */
const FOCUS_DELAY_MS: number = 0;

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
      theme: DEFAULT_THEME,
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
   * Renders a fallback message when the terminal is not running inside Electron.
   */
  private renderUnavailable(): void {
    this.container().nativeElement.textContent =
      'Terminal is only available when running inside Electron.';
  }
}
