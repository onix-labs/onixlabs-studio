import {
  computed,
  inject,
  OnDestroy,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';

/**
 * The identifier the terminal panel is registered under in the dock blueprints, used to reveal the
 * panel that renders these sessions.
 */
const TERMINAL_PANEL_ID: string = 'terminal';

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
   * Gets the folder the session's shell was rooted at when created, or undefined when none was known.
   */
  readonly cwd?: string;

  /**
   * Gets the shell executable the session actually spawned, or undefined until it reports one.
   */
  readonly shell?: string;
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
   * Gets the sessions in tab order.
   */
  public readonly sessions: Signal<readonly TerminalSession[]> = this.items.asReadonly();

  /**
   * Gets the active session's identifier, or null when there are none.
   */
  public readonly activeId: Signal<string | null> = this.active.asReadonly();

  /**
   * Sets the folder the sessions are rooted at. The first root opens one terminal; changing to a
   * different folder (or to none, when the folder closes) disposes the existing sessions — their
   * shells are rooted in the old folder — and opens a fresh one under the new root. Re-announcing
   * the same root (as the panel does whenever it re-mounts) leaves the sessions untouched.
   * @param root The absolute folder path, or null when no folder is open.
   */
  public setRoot(root: string | null): void {
    if (root === this.root) {
      return;
    }
    this.root = root;
    this.reset();
    if (root !== null) {
      this.create();
    }
  }

  /**
   * Creates a new terminal session rooted at the current folder and makes it active.
   * @returns Returns the created session.
   */
  public create(): TerminalSession {
    const session: TerminalSession = {
      id: `term-${crypto.randomUUID()}`,
      name: `Terminal ${++this.sequence}`,
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
   * Disposes every session when the owning tab closes.
   */
  public ngOnDestroy(): void {
    this.reset();
  }

  /**
   * Disposes every session's PTY and clears the list, restarting the default naming.
   */
  private reset(): void {
    for (const session of this.items()) {
      void this.bridge.dispose(session.id);
    }
    this.items.set([]);
    this.active.set(null);
    this.sequence = 0;
  }
}
