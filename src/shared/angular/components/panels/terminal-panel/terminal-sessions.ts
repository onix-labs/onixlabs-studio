import { Service, signal, Signal, WritableSignal } from '@angular/core';

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
}

/**
 * Owns the list of terminal sessions a single {@link import('./terminal-panel').TerminalPanel} shows,
 * so one workspace can run several terminals at once. Provided per panel instance (each dock's terminal
 * panel gets its own list), the runtime already being multi-instance — the main-process terminal
 * manager keys PTYs by identifier — so this only adds the list, selection, and naming the panel drives.
 *
 * The panel renders every session at once (only the active one visible) so switching a terminal, or
 * hiding the panel on a tab switch, never tears its PTY down; closing a session removes it, and the
 * terminal view it backed disposes the PTY as it is destroyed.
 */
@Service()
export class TerminalSessions {
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
   * Gets the sessions in tab order.
   */
  public readonly sessions: Signal<readonly TerminalSession[]> = this.items.asReadonly();

  /**
   * Gets the active session's identifier, or null when there are none.
   */
  public readonly activeId: Signal<string | null> = this.active.asReadonly();

  /**
   * Creates a new terminal session with a default name and makes it active.
   * @returns Returns the created session.
   */
  public create(): TerminalSession {
    const session: TerminalSession = {
      id: `term-${crypto.randomUUID()}`,
      name: `Terminal ${++this.sequence}`,
    };
    this.items.update((sessions: readonly TerminalSession[]): readonly TerminalSession[] => [
      ...sessions,
      session,
    ]);
    this.active.set(session.id);
    return session;
  }

  /**
   * Creates a first session when the panel has none, so it always opens with one terminal.
   */
  public ensureOne(): void {
    if (this.items().length === 0) {
      this.create();
    }
  }

  /**
   * Closes a session, activating an adjacent one when the closed session was active.
   * @param id The session identifier.
   */
  public close(id: string): void {
    const sessions: readonly TerminalSession[] = this.items();
    const index: number = sessions.findIndex((session: TerminalSession): boolean => session.id === id);
    if (index === -1) {
      return;
    }
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
   * Makes a session active, bringing its terminal to the front.
   * @param id The session identifier.
   */
  public activate(id: string): void {
    this.active.set(id);
  }
}
