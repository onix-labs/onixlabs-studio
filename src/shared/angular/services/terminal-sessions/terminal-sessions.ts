import {
  computed,
  inject,
  OnDestroy,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { TerminalCreateResult, TerminalKind } from '@shared/api/terminal-channels';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';

/**
 * The identifier the terminal panel is registered under in the dock blueprints, used to reveal the
 * panel that renders these sessions.
 */
const TERMINAL_PANEL_ID: string = 'terminal';

/**
 * The synthetic exit code a pending completion resolves with when its session is disposed without an
 * exit of its own (the tab or folder closed while the command ran, or a relaunch replaced it).
 * Callers awaiting a completion use it to tell "went away" from a real exit.
 */
export const DISPOSED_EXIT_CODE: number = -1;

/**
 * One docked terminal session: its globally-unique PTY identifier and its display name.
 */
export interface TerminalSession {
  /**
   * Gets the globally-unique identifier of the terminal's PTY session.
   */
  readonly id: string;

  /**
   * Gets the terminal's display name, shown on its tab.
   */
  readonly name: string;

  /**
   * Gets the session kind: an interactive `shell`, an interactive `run` command, or a read-only
   * `task` command.
   */
  readonly kind: TerminalKind;

  /**
   * Counts the launches under this session's tab. A relaunch bumps it, so the panel re-keys the
   * session's pane — a fresh xterm replaying the fresh PTY's buffer.
   */
  readonly generation: number;

  /**
   * Gets the exit code the session's process ended with, or null while it runs.
   */
  readonly exitCode: number | null;

  /**
   * Gets the folder the session's shell was rooted at when created, or undefined when none was known.
   */
  readonly cwd?: string;

  /**
   * Gets the shell executable the session actually spawned, or undefined until it reports one.
   */
  readonly shell?: string;
}

/**
 * The options for launching a command-backed terminal session.
 */
export interface TerminalLaunchOptions {
  /**
   * Gets the session to reuse (relaunch-in-place: the previous process is disposed and the tab gets
   * a fresh PTY and buffer), or undefined to open a new session tab. An unknown identifier opens a
   * new session under it, so callers may hold a stable identifier across launches.
   */
  readonly sessionId?: string;

  /**
   * Gets the tab's display name (for example `Build`, or `Run: Api`).
   */
  readonly name: string;

  /**
   * Gets the session kind: `run` (interactive) or `task` (read-only; Ctrl+C interrupts).
   */
  readonly kind: 'run' | 'task';

  /**
   * Gets the command to execute — a shell command line, or an executable when {@link args} is given.
   */
  readonly command: string;

  /**
   * Gets the argument vector for a directly-spawned executable, or undefined to run {@link command}
   * through the platform shell.
   */
  readonly args?: readonly string[];

  /**
   * Gets environment variables layered over the application's environment.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Gets the working directory, or undefined to use the sessions' root folder.
   */
  readonly cwd?: string;
}

/**
 * A launched command-backed session: its session model and a promise resolving with the process exit
 * code — the completion signal build/run flows await (PTY exit is the completion; no sentinels).
 */
export interface TerminalLaunch {
  /**
   * Gets the launched session.
   */
  readonly session: TerminalSession;

  /**
   * Gets a promise resolving with the exit code once the process ends (immediately, when the launch
   * failed outright). Resolves with -1 when the session is disposed mid-run (its tab closed).
   */
  readonly exited: Promise<number>;
}

/**
 * Owns the terminal sessions of one workspace (or repository) tab, so they outlive the dock's
 * terminal panel: tool stacks destroy an inactive panel when another activates, so a session list
 * scoped to the panel would tear every PTY down on a tool-tab switch. Provided at the view level
 * instead — alongside the view's other tab-scoped state — the sessions (and their main-process PTYs,
 * which retain scrollback for replay) survive until the tab closes; the panel is just a view over
 * this service, re-attaching a pane per session whenever it re-mounts.
 *
 * The service owns session lifecycle: closing a session (or the whole tab, or switching the tab to a
 * different folder) disposes its PTY and retained scrollback in the main process. Programmatic flows
 * activate a session through {@link activateAndReveal}, which also surfaces the terminal panel in the
 * view's dock (peeking its stack when collapsed).
 *
 * Known edge: closing the terminal *panel* from its title bar removes it from the layout without
 * closing the sessions — they stay alive (idle at a prompt) and re-attachable, and are disposed with
 * the tab. Floating the panel must not kill sessions either, so absence from the layout tree is
 * deliberately not treated as closure.
 */
@Service()
export class TerminalSessions implements OnDestroy {
  /**
   * Holds the terminal bridge sessions are disposed through when they close.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the dock reveal helper used to surface the terminal panel when a session is activated
   * programmatically.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the sessions in tab order.
   */
  private readonly items: WritableSignal<readonly TerminalSession[]> = signal<
    readonly TerminalSession[]
  >([]);

  /**
   * Holds the active session's identifier, or null when there are no sessions.
   */
  private readonly active: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Counts the sessions created, so each gets a distinct default name.
   */
  private sequence: number = 0;

  /**
   * Holds the folder the sessions are rooted at, or null before one is known.
   */
  private root: string | null = null;

  /**
   * Holds the pending completion resolvers of launched sessions, keyed by session identifier, each
   * resolved with the exit code when the session's process ends.
   */
  private readonly waiters: Map<string, (exitCode: number) => void> = new Map<
    string,
    (exitCode: number) => void
  >();

  /**
   * Holds the disposer for the exit-event subscription.
   */
  private readonly unsubscribeExit: () => void;

  /**
   * Initializes a new instance of the {@link TerminalSessions} class, tracking process exits so each
   * session's model records its exit code (even while no pane is attached) and pending completions
   * resolve.
   */
  public constructor() {
    this.unsubscribeExit = this.bridge.onExit(
      (id: string, exitCode: number, signal: number | null): void => {
        const known: boolean = this.items().some(
          (session: TerminalSession): boolean => session.id === id,
        );
        if (!known) {
          return;
        }
        // A signal-terminated process often reports exit code 0; record the shell convention
        // (128 + signal) instead, so a stopped run never reads as a success to awaiting callers.
        const effective: number = signal !== null ? 128 + signal : exitCode;
        this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] =>
          sessions.map(
            (session: TerminalSession): TerminalSession =>
              session.id === id ? { ...session, exitCode: effective } : session,
          ),
        );
        this.resolveWaiter(id, effective);
      },
    );
  }

  /**
   * Gets the sessions in tab order.
   */
  public readonly sessions: Signal<readonly TerminalSession[]> = this.items.asReadonly();

  /**
   * Gets the active session's identifier, or null when there are none.
   */
  public readonly activeId: Signal<string | null> = this.active.asReadonly();

  /**
   * Sets the folder the sessions are rooted at. Announced by the owning view (not the panel — a
   * session can be launched before the panel ever mounts, and the panel's first mount must not
   * disturb it). Moving to a different folder (or to none, when the folder closes) disposes the
   * existing sessions — they are rooted in the old folder; re-announcing the same root is a no-op.
   * The first root deliberately opens nothing: the panel asks for its shell via
   * {@link ensureShell} when it shows, and launched sessions carry their own working directories.
   * @param root The absolute folder path, or null when no folder is open.
   */
  public setRoot(root: string | null): void {
    if (root === this.root) {
      return;
    }
    const hadRoot: boolean = this.root !== null;
    this.root = root;
    if (hadRoot) {
      this.reset();
    }
  }

  /**
   * Opens a shell session when none exists, so the terminal panel always shows with a usable shell —
   * without disturbing command-backed sessions that may already be running. Called by the panel as it
   * mounts; a no-op before a folder is known (a shell spawned earlier would have the wrong working
   * directory).
   */
  public ensureShell(): void {
    if (this.root === null) {
      return;
    }
    const hasShell: boolean = this.items().some(
      (session: TerminalSession): boolean => session.kind === 'shell',
    );
    if (!hasShell) {
      // Keep the current session in front: the panel may be mounting precisely because a launched
      // session revealed it, and the fresh shell must not steal that activation.
      const active: string | null = this.active();
      this.create();
      if (active !== null) {
        this.active.set(active);
      }
    }
  }

  /**
   * Creates a new interactive shell session rooted at the current folder and makes it active.
   * @returns Returns the created session.
   */
  public create(): TerminalSession {
    const session: TerminalSession = {
      id: `term-${crypto.randomUUID()}`,
      name: `Terminal ${++this.sequence}`,
      kind: 'shell',
      generation: 0,
      exitCode: null,
      cwd: this.root ?? undefined,
    };
    this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] => [
      ...sessions,
      session,
    ]);
    this.active.set(session.id);
    return session;
  }

  /**
   * Launches a command in a command-backed session and reveals it: a `run` session is interactive
   * (the program reads the user's keystrokes); a `task` session is read-only except Ctrl+C. Reusing
   * a session identifier relaunches in place — the previous process is disposed (killing it when
   * still running) and the tab starts a fresh PTY with a fresh buffer. The PTY is spawned by this
   * service, not by the panel's pane, so a launch works even while the terminal panel is hidden;
   * attached panes re-key on the session's generation and replay the new buffer.
   * @param options The launch options.
   * @returns Returns the launched session and its completion promise.
   */
  public async launch(options: TerminalLaunchOptions): Promise<TerminalLaunch> {
    const existing: TerminalSession | undefined =
      options.sessionId === undefined
        ? undefined
        : this.items().find(
            (session: TerminalSession): boolean => session.id === options.sessionId,
          );
    const id: string = options.sessionId ?? `term-${crypto.randomUUID()}`;
    const cwd: string | undefined = options.cwd ?? this.root ?? undefined;

    if (existing !== undefined) {
      // Relaunch-in-place: silence any pending completion, then dispose the previous PTY (and its
      // scrollback) so the reused identifier spawns fresh. Disposal never emits an exit event, so
      // the old process's end cannot masquerade as the new run's.
      this.resolveWaiter(id, DISPOSED_EXIT_CODE);
      await this.bridge.dispose(id);
      this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] =>
        sessions.map(
          (session: TerminalSession): TerminalSession =>
            session.id === id
              ? {
                  ...session,
                  name: options.name,
                  kind: options.kind,
                  generation: session.generation + 1,
                  exitCode: null,
                  cwd,
                  shell: undefined,
                }
              : session,
        ),
      );
    } else {
      const session: TerminalSession = {
        id,
        name: options.name,
        kind: options.kind,
        generation: 0,
        exitCode: null,
        cwd,
      };
      this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] => [
        ...sessions,
        session,
      ]);
    }

    // Register the completion before spawning, so an instantly-exiting command cannot slip its exit
    // event past the waiter.
    const exited: Promise<number> = new Promise<number>((resolve: (code: number) => void): void => {
      this.waiters.set(id, resolve);
    });

    const result: TerminalCreateResult = await this.bridge.create({
      id,
      kind: options.kind,
      command: options.command,
      args: options.args,
      env: options.env,
      cwd,
    });
    if (!result.success) {
      // The main process streamed the failure into the session's scrollback and emitted an exit for
      // it where possible; outside Electron (or on malformed options) resolve the completion here.
      this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] =>
        sessions.map(
          (session: TerminalSession): TerminalSession =>
            session.id === id && session.exitCode === null ? { ...session, exitCode: 1 } : session,
        ),
      );
      this.resolveWaiter(id, 1);
    }

    this.activateAndReveal(id);
    const session: TerminalSession =
      this.items().find((candidate: TerminalSession): boolean => candidate.id === id) ??
      ({ id, name: options.name, kind: options.kind, generation: 0, exitCode: null, cwd });
    return { session, exited };
  }

  /**
   * Waits for a session's process to end.
   * @param id The session identifier.
   * @returns Returns a promise resolving with the exit code — immediately, when it already exited.
   */
  public waitForExit(id: string): Promise<number> {
    const session: TerminalSession | undefined = this.items().find(
      (candidate: TerminalSession): boolean => candidate.id === id,
    );
    if (session?.exitCode != null) {
      return Promise.resolve(session.exitCode);
    }
    const pending: ((exitCode: number) => void) | undefined = this.waiters.get(id);
    if (pending !== undefined) {
      // Chain onto the existing waiter so both callers resolve.
      return new Promise<number>((resolve: (code: number) => void): void => {
        this.waiters.set(id, (exitCode: number): void => {
          pending(exitCode);
          resolve(exitCode);
        });
      });
    }
    return new Promise<number>((resolve: (code: number) => void): void => {
      this.waiters.set(id, resolve);
    });
  }

  /**
   * Terminates a session's process tree (SIGTERM escalating to SIGKILL) while keeping its tab,
   * scrollback, and exit banner — the Stop action for command-backed sessions.
   * @param id The session identifier.
   */
  public terminate(id: string): void {
    void this.bridge.terminate(id);
  }

  /**
   * Resolves and removes a session's pending completion, when one is registered.
   * @param id The session identifier.
   * @param exitCode The exit code to resolve with.
   */
  private resolveWaiter(id: string, exitCode: number): void {
    const waiter: ((exitCode: number) => void) | undefined = this.waiters.get(id);
    if (waiter !== undefined) {
      this.waiters.delete(id);
      waiter(exitCode);
    }
  }

  /**
   * Closes a session, disposing its PTY (and retained scrollback) and activating an adjacent session
   * when the closed one was active.
   * @param id The session identifier.
   */
  public close(id: string): void {
    const sessions: readonly TerminalSession[] = this.items();
    const index: number = sessions.findIndex(
      (session: TerminalSession): boolean => session.id === id,
    );
    if (index === -1) {
      return;
    }
    this.resolveWaiter(id, DISPOSED_EXIT_CODE);
    void this.bridge.dispose(id);
    const remaining: readonly TerminalSession[] = sessions.filter(
      (session: TerminalSession): boolean => session.id !== id,
    );
    this.items.set(remaining);
    if (this.active() === id) {
      // Prefer the session that took the closed one's place, then the new last one, then none.
      const next: TerminalSession | undefined = remaining[index] ?? remaining[remaining.length - 1];
      this.active.set(next?.id ?? null);
    }
  }

  /**
   * Renames a session, ignoring a blank name.
   * @param id The session identifier.
   * @param name The new display name.
   */
  public rename(id: string, name: string): void {
    const trimmed: string = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] =>
      sessions.map(
        (session: TerminalSession): TerminalSession =>
          session.id === id ? { ...session, name: trimmed } : session,
      ),
    );
  }

  /**
   * Makes a session active, bringing its terminal to the front of the panel.
   * @param id The session identifier.
   */
  public activate(id: string): void {
    this.active.set(id);
  }

  /**
   * Makes a session active and reveals the terminal panel in the view's dock — activating its stack,
   * or peeking it when collapsed — so a programmatic activation (a run starting, an agent driving a
   * terminal) surfaces the terminal even while the panel is hidden.
   * @param id The session identifier; an unknown identifier is ignored.
   */
  public activateAndReveal(id: string): void {
    const known: boolean = this.items().some(
      (session: TerminalSession): boolean => session.id === id,
    );
    if (!known) {
      return;
    }
    this.active.set(id);
    this.dockReveal.reveal(TERMINAL_PANEL_ID);
  }

  /**
   * Records the shell a session's terminal actually spawned, so the status strip can show it.
   * @param id The session identifier.
   * @param shell The spawned shell executable.
   */
  public setShell(id: string, shell: string): void {
    this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] =>
      sessions.map(
        (session: TerminalSession): TerminalSession =>
          session.id === id ? { ...session, shell } : session,
      ),
    );
  }

  /**
   * Gets the active session, or null when there are none.
   */
  public readonly activeSession: Signal<TerminalSession | null> = computed(
    (): TerminalSession | null =>
      this.items().find((session: TerminalSession): boolean => session.id === this.active()) ?? null,
  );

  /**
   * Disposes every session when the owning tab closes, and stops tracking exits.
   */
  public ngOnDestroy(): void {
    this.reset();
    this.unsubscribeExit();
  }

  /**
   * Disposes every session's PTY and clears the list, restarting the default naming. Pending
   * completions resolve with the disposed code so no caller is left awaiting a run that is gone.
   */
  private reset(): void {
    for (const session of this.items()) {
      this.resolveWaiter(session.id, DISPOSED_EXIT_CODE);
      void this.bridge.dispose(session.id);
    }
    this.items.set([]);
    this.active.set(null);
    this.sequence = 0;
  }
}
