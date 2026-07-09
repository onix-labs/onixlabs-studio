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
import { ITheme, Terminal as Xterm } from '@xterm/xterm';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { Terminals } from '@shared/angular/services/terminals/terminals';
import { AccentColor, Theme } from '@shared/angular/services/theme/theme';
import { TerminalCreateResult } from '@shared/api/terminal-channels';

/**
 * Holds the delay, in milliseconds, used to defer initial focus until the view has settled.
 */
const FOCUS_DELAY_MS: number = 0;

/**
 * Holds the opacity applied to the accent colour when used as the terminal's selection background.
 */
const SELECTION_ALPHA: number = 0.3;

/**
 * Represents the shared terminal pane: an xterm.js instance wired to a main-process node-pty session
 * through the {@link TerminalBridge}. It is the reusable capability wrapper consumed by the terminal
 * feature view and by docked terminal panels; it renders and drives a single terminal and nothing
 * else (no splitter, no agent panel, no ribbon — those belong to the composing feature).
 *
 * The session is kept alive while the pane is hidden; on re-activation the terminal is re-fitted and
 * focused. Callers drive it through its imperative methods (clear, copy, restart, …) and observe it
 * through its outputs (ready, titleChange, exited).
 */
@Component({
  selector: 'app-terminal',
  templateUrl: './terminal.html',
  styleUrl: './terminal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Terminal implements AfterViewInit, OnDestroy {
  /**
   * Holds the terminal bridge used to manage the PTY session lifecycle and I/O.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the theme service used to keep the terminal colours in sync with the application theme.
   */
  private readonly themeService: Theme = inject(Theme);

  /**
   * Holds the registry this terminal registers its output handle with, so a terminal agent can read
   * its on-screen output by id without holding a reference to the pane.
   */
  private readonly terminals: Terminals = inject(Terminals);

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
   * Gets the shell executable the session starts with, or undefined to use the main process's default.
   * Seeds the first spawn; a later {@link switchShell} overrides it for subsequent spawns.
   */
  public readonly shell: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the pane is currently shown. When it becomes active the terminal
   * is re-fitted and focused.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits once the PTY session is created and its I/O is wired up.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the terminal title whenever the shell changes it (for example via an escape sequence).
   */
  public readonly titleChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the exit code when the PTY process exits.
   */
  public readonly exited: OutputEmitterRef<number> = output<number>();

  /**
   * Holds the container element that hosts the xterm canvas.
   */
  private readonly container: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('container');

  /**
   * Holds a value indicating whether the xterm instance and PTY session are initialised.
   */
  private readonly terminalReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the shell the next spawn should use, overriding the {@link shell} input. Set to the shell a
   * new session is started with, and refreshed to the shell actually spawned, so a plain {@link restart}
   * reuses the current shell. Null falls back to the {@link shell} input (the configured default).
   */
  private overriddenShell: string | null = null;

  /**
   * Holds the xterm instance, or null before initialisation.
   */
  private xterm: Xterm | null = null;

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
  private hasExited: boolean = false;

  /**
   * Holds a value indicating whether scroll lock is engaged, freezing the viewport as output streams.
   */
  private scrollLocked: boolean = false;

  /**
   * Initializes a new instance of the {@link Terminal} class, wiring the activation and theme effects.
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
    this.terminals.unregister(this.terminalId());
    if (!this.hasExited) {
      void this.bridge.dispose(this.terminalId());
    }
    this.xterm?.dispose();
    this.xterm = null;
    this.fitAddon = null;
  }

  /**
   * Re-fits the terminal to its container and notifies the PTY of the new size. Safe to call at any
   * time; a fit on a zero-sized host (e.g. while hidden) is ignored.
   */
  public handleResize(): void {
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
   * Focuses the terminal.
   */
  public focus(): void {
    this.xterm?.focus();
  }

  /**
   * Sets whether scroll lock is engaged. While locked the viewport stays where the reader parked it as
   * new output streams in (rather than following the tail), and user keystrokes no longer jump to the
   * bottom; unlocking restores the normal follow-the-output behaviour.
   * @param locked Whether to engage scroll lock.
   */
  public setScrollLocked(locked: boolean): void {
    this.scrollLocked = locked;
    if (this.xterm !== null) {
      this.xterm.options.scrollOnUserInput = !locked;
    }
  }

  /**
   * Clears the terminal screen and returns focus to it.
   */
  public clear(): void {
    this.xterm?.clear();
    this.xterm?.focus();
  }

  /**
   * Writes a shell command (followed by a carriage return) to the terminal and returns focus to it.
   * @param command The command to run.
   */
  public runCommand(command: string): void {
    void this.bridge.write(this.terminalId(), `${command}\r`);
    this.xterm?.focus();
  }

  /**
   * Copies the current selection to the clipboard, falling back to the whole buffer when nothing is
   * selected, then returns focus to the terminal.
   */
  public copy(): void {
    const xterm: Xterm | null = this.xterm;
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
   * Copies the whole buffer to the clipboard, then clears the screen.
   */
  public cut(): void {
    const xterm: Xterm | null = this.xterm;
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
   * Pastes the clipboard contents into the terminal's input stream.
   */
  public paste(): void {
    const id: string = this.terminalId();
    void navigator.clipboard.readText().then((text: string): void => {
      if (text.length > 0) {
        void this.bridge.write(id, text);
      }
    });
    this.xterm?.focus();
  }

  /**
   * Gets the PTY's current working directory.
   * @returns Returns the working directory, or null when it cannot be determined.
   */
  public getCwd(): Promise<string | null> {
    return this.bridge.getCwd(this.terminalId());
  }

  /**
   * Gets a value indicating whether the PTY process has exited.
   * @returns Returns true when the process has exited.
   */
  public get isExited(): boolean {
    return this.hasExited;
  }

  /**
   * Starts a fresh session, respawning under the given shell — or the configured default when none is
   * given — while keeping the terminal identifier. Unlike {@link restart}, which reuses the current
   * shell, this replaces it.
   * @param shell The shell executable to run, or undefined to use the configured default.
   * @returns Returns a promise that resolves once the new session has spawned.
   */
  public async newSession(shell?: string): Promise<void> {
    this.overriddenShell = shell ?? null;
    await this.restart();
  }

  /**
   * Destroys the current xterm and PTY session and spawns a fresh one in its place, keeping the
   * terminal identifier. The session is disposed before the new one spawns so the main process does
   * not reuse the dying session.
   */
  public async restart(): Promise<void> {
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
   * Creates the xterm instance, starts the PTY session, and wires up bidirectional I/O.
   */
  private async initialize(): Promise<void> {
    if (!this.bridge.isElectron) {
      this.renderUnavailable();
      return;
    }

    const id: string = this.terminalId();
    const host: HTMLDivElement = this.container().nativeElement;

    const xterm: Xterm = new Xterm({
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
      shell: this.overriddenShell ?? this.shell(),
    });
    if (!result.success) {
      xterm.writeln(`\x1b[31mFailed to start terminal: ${result.error ?? 'unknown error'}\x1b[0m`);
      return;
    }
    // Remember the shell actually spawned so a plain restart reuses it, immune to a later change of the
    // configured default; a New session explicitly resets this first.
    this.overriddenShell = result.shell ?? this.overriddenShell;

    this.cleanupOnData = this.bridge.onData((targetId: string, data: string): void => {
      if (targetId === id) {
        this.writeOutput(data);
      }
    });

    this.cleanupOnExit = this.bridge.onExit((targetId: string, exitCode: number): void => {
      if (targetId !== id) {
        return;
      }
      this.hasExited = true;
      this.xterm?.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`);
      this.exited.emit(exitCode);
    });

    xterm.onData((data: string): void => {
      void this.bridge.write(id, data);
    });

    xterm.onTitleChange((title: string): void => {
      this.titleChange.emit(title);
    });

    this.resizeObserver = new ResizeObserver((): void => this.handleResize());
    this.resizeObserver.observe(host);

    // Register this terminal's output handle so a terminal agent can read its on-screen text by id.
    this.terminals.register(id, { readText: (): string => this.getBufferText() });

    setTimeout((): void => xterm.focus(), FOCUS_DELAY_MS);
    this.terminalReady.set(true);
    this.ready.emit();
  }

  /**
   * Writes PTY output to the terminal, honouring scroll lock. While locked the viewport is restored to
   * its pre-write top line once xterm has parsed the chunk, so streaming output does not drag the view
   * down to the tail. Content that ages out of the scrollback still scrolls away naturally.
   * @param data The output chunk from the PTY.
   */
  private writeOutput(data: string): void {
    const xterm: Xterm | null = this.xterm;
    if (xterm === null) {
      return;
    }
    if (!this.scrollLocked) {
      xterm.write(data);
      return;
    }
    const top: number = xterm.buffer.active.viewportY;
    xterm.write(data, (): void => xterm.scrollToLine(top));
  }

  /**
   * Reads the full buffer of the terminal as plain text, with trailing blank lines removed.
   * @returns Returns the terminal buffer contents.
   */
  private getBufferText(): string {
    const xterm: Xterm | null = this.xterm;
    if (xterm === null) {
      return '';
    }
    const buffer: Xterm['buffer']['active'] = xterm.buffer.active;
    const lines: string[] = [];
    for (let index: number = 0; index < buffer.length; index++) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    }
    return lines.join('\n').replace(/\n+$/, '');
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
