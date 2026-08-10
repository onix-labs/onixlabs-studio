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
import { ISearchOptions, SearchAddon } from '@xterm/addon-search';
import { IBufferLine, ITheme, Terminal as Xterm } from '@xterm/xterm';
import { Log } from '@shared/angular/services/log/log';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { Terminals } from '@shared/angular/services/terminals/terminals';
import { Theme } from '@shared/angular/services/theme/theme';
import { TerminalCreateResult, TerminalKind, TerminalReplay } from '@shared/api/terminal-channels';

/**
 * The interrupt character (Ctrl+C). The single keystroke a read-only `task` pane forwards to its
 * session, where the terminal line discipline turns it into SIGINT (the main process enforces the
 * same gate for every other writer).
 */
const INTERRUPT: string = '\x03';

/**
 * Holds the delay, in milliseconds, used to defer initial focus until the view has settled.
 */
const FOCUS_DELAY_MS: number = 0;

/**
 * Holds the opacity applied to the accent colour when used as the terminal's selection background.
 */
const SELECTION_ALPHA: number = 0.3;

/**
 * Holds the smallest host size, in CSS pixels, a pane may fit (and resize its PTY) at. A host below
 * this is not a real layout — it is hidden, detached, or mid-layout (a dock teardown, an auxiliary
 * window whose stylesheets are still loading) — and fitting then would clamp xterm to its 2-column
 * minimum and ship that to the PTY. The PTY resize is last-writer-wins across panes, and a shell
 * redrawing its prompt at 2 columns hard-wraps it into the retained scrollback, permanently
 * polluting every later replay.
 */
const MIN_FIT_WIDTH_PX: number = 40;

/**
 * Holds the smallest host height, in CSS pixels, a pane may fit at. See {@link MIN_FIT_WIDTH_PX}.
 */
const MIN_FIT_HEIGHT_PX: number = 20;

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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
   * Gets a value indicating whether the PTY session outlives this pane. When true, destroying the
   * pane detaches from the session instead of disposing it — the session's owner (for example a
   * workspace's terminal-sessions service) disposes it — and a later pane under the same identifier
   * re-attaches, replaying the output the session produced while no pane was mounted.
   */
  public readonly persistent: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the session kind the pane renders. A `shell` pane spawns its interactive shell on mount (the
   * historical behaviour); `run` and `task` panes only attach — their command-backed sessions are
   * spawned by the owning service — and a `task` pane forwards no keystrokes except Ctrl+C.
   */
  public readonly kind: InputSignal<TerminalKind> = input<TerminalKind>('shell');

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
   * Emits the shell executable the session actually spawned, once it is running (including after a
   * {@link newSession} or {@link restart}), so the owning view can reflect the terminal type.
   */
  public readonly shellChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits when the user presses the find chord (Cmd+F on macOS, Ctrl+Shift+F elsewhere) inside the
   * terminal, so the owning view can open its find panel. The chord is swallowed rather than forwarded
   * to the shell, so it never collides with the shell's own key bindings.
   */
  public readonly findRequested: OutputEmitterRef<void> = output<void>();

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
   * Holds the search addon used to highlight and navigate find matches across the whole buffer
   * (including scrollback), or null before initialisation.
   */
  private searchAddon: SearchAddon | null = null;

  /**
   * Holds the listener notified whenever the search results change, or null when no find panel is
   * observing. The addon reports the active match index (-1 when none) and the total match count.
   */
  private searchResultsListener: ((activeIndex: number, count: number) => void) | null = null;

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
   * Holds output chunks parked while the scrollback snapshot is in flight during initialisation, or
   * null once live (chunks are then written straight to the terminal). Parked chunks the snapshot
   * already contains are discarded by sequence number when the snapshot lands.
   */
  private pendingChunks: { data: string; seq: number }[] | null = null;

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
   * Tears down the xterm instance and listeners on destroy — and the PTY session too, unless the
   * pane is {@link persistent} (then the session and its retained scrollback live on for a later
   * pane to re-attach to). Disposing also clears the session's retained scrollback in the main
   * process, even when the process itself has already exited.
   */
  public ngOnDestroy(): void {
    this.log.info('Terminal', `Destroying pane '${this.terminalId()}'`, `persistent=${this.persistent()}`);
    this.cleanupOnData?.();
    this.cleanupOnExit?.();
    this.resizeObserver?.disconnect();
    this.terminals.unregister(this.terminalId());
    if (!this.persistent()) {
      void this.bridge.dispose(this.terminalId());
    }
    this.xterm?.dispose();
    this.xterm = null;
    this.fitAddon = null;
    this.searchAddon = null;
  }

  /**
   * Re-fits the terminal to its container and notifies the PTY of the new size. Safe to call at any
   * time; a host without a plausible layout (hidden, detached, or mid-layout) is ignored — neither
   * xterm nor the PTY is resized from a degenerate geometry.
   */
  public handleResize(): void {
    if (this.xterm === null || this.fitAddon === null || !this.fitToHost(this.fitAddon)) {
      return;
    }
    void this.bridge.resize(this.terminalId(), this.xterm.cols, this.xterm.rows);
  }

  /**
   * Fits the terminal to its host, when the host has a real layout to fit to. Guarding here (not
   * just at the PTY write) also keeps xterm itself from being clamped to its tiny minimum grid by
   * a transient zero-size measurement, which would reflow the buffer.
   * @param fitAddon The fit addon of the current xterm.
   * @returns Returns true when the terminal was fitted to a plausible host size.
   */
  private fitToHost(fitAddon: FitAddon): boolean {
    const host: HTMLDivElement = this.container().nativeElement;
    if (
      !host.isConnected ||
      host.clientWidth < MIN_FIT_WIDTH_PX ||
      host.clientHeight < MIN_FIT_HEIGHT_PX
    ) {
      return false;
    }
    try {
      fitAddon.fit();
      return true;
    } catch {
      // Fit can still throw on edge geometries; treat it as no usable layout.
      return false;
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
   * Scrolls the viewport to the newest output at the bottom of the buffer and returns focus to the
   * terminal — useful for jumping back to the tail while scroll lock holds the view in place.
   */
  public scrollToBottom(): void {
    this.xterm?.scrollToBottom();
    this.xterm?.focus();
  }

  /**
   * Highlights every occurrence of the term across the buffer and moves the active match to the next
   * one after the current selection, scrolling it into view. A find panel drives highlighting and
   * forward navigation through this method.
   * @param term The text (or pattern) to search for.
   * @param options The search options (regex, whole-word, case sensitivity, decorations).
   */
  public searchNext(term: string, options: ISearchOptions): void {
    this.searchAddon?.findNext(term, options);
  }

  /**
   * Moves the active match to the previous occurrence of the term, scrolling it into view. Shares the
   * highlight set established by {@link searchNext}.
   * @param term The text (or pattern) to search for.
   * @param options The search options (regex, whole-word, case sensitivity, decorations).
   */
  public searchPrevious(term: string, options: ISearchOptions): void {
    this.searchAddon?.findPrevious(term, options);
  }

  /**
   * Clears the search highlights from the buffer.
   */
  public clearSearch(): void {
    this.searchAddon?.clearDecorations();
  }

  /**
   * Registers a listener notified whenever the search results change, replacing any previous listener.
   * The addon reports the active match index (-1 when there is no active match) and the total count.
   * @param listener The results listener.
   * @returns Returns a function that removes the listener.
   */
  public onSearchResults(listener: (activeIndex: number, count: number) => void): () => void {
    this.searchResultsListener = listener;
    return (): void => {
      if (this.searchResultsListener === listener) {
        this.searchResultsListener = null;
      }
    };
  }

  /**
   * Reads the buffer as logical (unwrapped) lines: rows the renderer soft-wrapped are rejoined onto the
   * line they continue. Used to build the find panel's match previews.
   * @returns Returns the logical lines of the buffer.
   */
  public bufferLines(): readonly string[] {
    const xterm: Xterm | null = this.xterm;
    if (xterm === null) {
      return [];
    }
    const buffer: Xterm['buffer']['active'] = xterm.buffer.active;
    const lines: string[] = [];
    for (let index: number = 0; index < buffer.length; index++) {
      const row: IBufferLine | undefined = buffer.getLine(index);
      if (row === undefined) {
        continue;
      }
      const text: string = row.translateToString(true);
      if (row.isWrapped && lines.length > 0) {
        lines[lines.length - 1] += text;
      } else {
        lines.push(text);
      }
    }
    return lines;
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
    this.log.info('Terminal', `Restarting session '${id}'`);

    this.cleanupOnData?.();
    this.cleanupOnData = null;
    this.cleanupOnExit?.();
    this.cleanupOnExit = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.terminalReady.set(false);

    // Dispose even when the process has already exited: that clears the session's retained
    // scrollback, so the fresh session starts from a clean record rather than replaying the old one.
    await this.bridge.dispose(id);
    this.hasExited = false;

    this.xterm?.dispose();
    this.xterm = null;
    this.fitAddon = null;
    this.searchAddon = null;

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
      // A read-only task console has no meaningful caret; a blinking one would suggest typing works.
      cursorBlink: this.kind() !== 'task',
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon: FitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    const searchAddon: SearchAddon = new SearchAddon();
    xterm.loadAddon(searchAddon);
    searchAddon.onDidChangeResults(({ resultIndex, resultCount }): void =>
      this.searchResultsListener?.(resultIndex, resultCount),
    );

    xterm.open(host);
    this.xterm = xterm;
    this.fitAddon = fitAddon;
    this.searchAddon = searchAddon;

    // Intercept the find chord before xterm forwards it to the PTY so it opens the find panel instead
    // of reaching the shell. Cmd+F on macOS; Ctrl+Shift+F elsewhere (bare Ctrl+F is a shell binding).
    xterm.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown' || event.key.toLowerCase() !== 'f') {
        return true;
      }
      const mac: boolean = window.host?.platform === 'darwin';
      const chord: boolean = mac
        ? event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
        : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
      if (!chord) {
        return true;
      }
      this.findRequested.emit();
      return false;
    });

    // Initial fit, skipped for hosts without a real layout yet (a hidden pane, an auxiliary window
    // still styling itself): xterm keeps its default grid and the resize observer below fits it —
    // and only then the PTY — once the host has a usable size.
    this.fitToHost(fitAddon);

    // Subscribe before replaying, parking chunks until the snapshot lands: the snapshot's sequence
    // number then tells which parked chunks it already contains, so nothing is lost or duplicated
    // while the two race.
    this.pendingChunks = [];
    this.cleanupOnData = this.bridge.onDataFor(id, (data: string, seq: number): void => {
      if (this.pendingChunks !== null) {
        this.pendingChunks.push({ data, seq });
      } else {
        this.writeOutput(data);
      }
    });

    this.cleanupOnExit = this.bridge.onExit(
      (targetId: string, exitCode: number, exitSignal: number | null): void => {
        if (targetId !== id) {
          return;
        }
        this.hasExited = true;
        this.xterm?.writeln(this.exitBanner(exitCode, exitSignal));
        this.exited.emit(exitCode);
      },
    );

    // Replay whatever the session produced while no pane was attached (empty for a fresh session),
    // then either surface its recorded end or (re)create the PTY — creation reuses a live session
    // under the same identifier, so re-attaching never respawns the shell.
    const replay: TerminalReplay = await this.bridge.replay(id);
    if (replay.data.length > 0) {
      xterm.write(replay.data);
    }

    if (replay.exitCode !== null) {
      // The session ended while detached: show its history and exit banner without spawning a new
      // process in its place; the session stays closable/restartable exactly like a live exit.
      this.hasExited = true;
      xterm.writeln(this.exitBanner(replay.exitCode, replay.signal));
    } else if (this.kind() === 'shell') {
      const result: TerminalCreateResult = await this.bridge.create({
        id,
        cols: xterm.cols,
        rows: xterm.rows,
        cwd: this.cwd(),
        shell: this.overriddenShell ?? this.shell(),
      });
      if (!result.success) {
        this.pendingChunks = null;
        this.log.error('Terminal', `Failed to start session '${id}'`, result.error ?? 'unknown error');
        xterm.writeln(
          `\x1b[31mFailed to start terminal: ${result.error ?? 'unknown error'}\x1b[0m`,
        );
        return;
      }
      // Remember the shell actually spawned so a plain restart reuses it, immune to a later change of
      // the configured default; a New session explicitly resets this first.
      this.overriddenShell = result.shell ?? this.overriddenShell;
      if (result.shell !== undefined) {
        this.shellChange.emit(result.shell);
      }
    } else {
      // Command-backed sessions are spawned by their owning service, never by the pane: attaching
      // early (before the launch) is fine — the subscription is live and the output streams in —
      // and attaching to nothing renders an empty pane rather than wrongly spawning a shell. Fit
      // the PTY to this pane's real size in case it was spawned at the default dimensions.
      void this.bridge.resize(id, xterm.cols, xterm.rows);
    }

    // Go live: write the parked chunks the snapshot did not already contain, in arrival order.
    const parked: readonly { data: string; seq: number }[] = this.pendingChunks ?? [];
    this.pendingChunks = null;
    for (const chunk of parked) {
      if (chunk.seq > replay.seq) {
        this.writeOutput(chunk.data);
      }
    }

    xterm.onData((data: string): void => {
      // A read-only task pane forwards only Ctrl+C (interrupt); the main process enforces the same
      // gate, this just avoids pointless round-trips for swallowed keystrokes.
      if (this.kind() === 'task' && data !== INTERRUPT) {
        return;
      }
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
    this.log.info('Terminal', `Session '${id}' ready`, `kind=${this.kind()}`);
    this.ready.emit();
  }

  /**
   * Builds the end-of-process banner. A signal-terminated process often reports exit code 0, so the
   * signal is named when present — a stopped run must not read as a success.
   * @param exitCode The process exit code.
   * @param signal The number of the signal that ended it, or null when it exited on its own.
   * @returns Returns the banner line.
   */
  private exitBanner(exitCode: number, signal: number | null): string {
    return signal !== null
      ? `\r\n\x1b[90m[Process terminated by signal ${signal}]\x1b[0m`
      : `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`;
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
    const light: string = read('--gray-100');
    const ink: string = read('--gray-900');
    return {
      background: dark ? ink : light,
      foreground: dark ? light : ink,
      cursor: this.themeService.accentHex(),
      cursorAccent: dark ? ink : light,
      selectionBackground: `rgba(${this.themeService.accentRgb()}, ${SELECTION_ALPHA})`,
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
