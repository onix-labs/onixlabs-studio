import { inject, OnDestroy, Service, signal, Signal, WritableSignal } from '@angular/core';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';

/**
 * One docker terminal session hosted in the Containers view's terminal panel: its PTY identifier and
 * the label shown on its tab (for example `Logs: web` or `web — shell`).
 */
export interface ContainerTerminal {
  /**
   * Gets the globally-unique identifier of the terminal's PTY session.
   */
  readonly id: string;

  /**
   * Gets the tab label.
   */
  readonly name: string;
}

/**
 * Owns the docker terminal sessions of the Containers view — the logs and shells opened from container
 * rows (P5). It reuses the existing terminal infrastructure: {@link TerminalBridge} spawns a
 * command-backed (`run`) PTY, and the view's `app-terminal` panes attach to it by id. Provided at the
 * view level so the sessions live as long as the Containers tab and are disposed with it.
 */
@Service()
export class ContainerTerminals implements OnDestroy {
  /**
   * Holds the terminal bridge that spawns and tears down the PTY sessions.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the open sessions, in the order they were opened.
   */
  private readonly sessionList: WritableSignal<readonly ContainerTerminal[]> = signal<
    readonly ContainerTerminal[]
  >([]);

  /**
   * Holds the active session's id, or null when there are none.
   */
  private readonly activeSessionId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the open sessions.
   */
  public readonly sessions: Signal<readonly ContainerTerminal[]> = this.sessionList.asReadonly();

  /**
   * Gets the active session's id, or null when there are none.
   */
  public readonly activeId: Signal<string | null> = this.activeSessionId.asReadonly();

  /**
   * Opens a new terminal running a command and makes it active. The pane attaches to the spawned PTY
   * by id; a failing command (for example a missing `docker` CLI) surfaces its error in the terminal.
   * @param name The tab label.
   * @param command The command line to run.
   */
  public open(name: string, command: string): void {
    const id: string = `docker-${crypto.randomUUID()}`;
    this.sessionList.update((sessions: readonly ContainerTerminal[]): readonly ContainerTerminal[] => [
      ...sessions,
      { id, name },
    ]);
    this.activeSessionId.set(id);
    void this.bridge.create({ id, kind: 'run', command });
  }

  /**
   * Activates an open session.
   * @param id The session id.
   */
  public activate(id: string): void {
    if (this.sessionList().some((session: ContainerTerminal): boolean => session.id === id)) {
      this.activeSessionId.set(id);
    }
  }

  /**
   * Closes a session: disposes its PTY and drops its tab, activating a neighbour when it was active.
   * @param id The session id.
   */
  public close(id: string): void {
    void this.bridge.dispose(id);
    this.sessionList.update((sessions: readonly ContainerTerminal[]): readonly ContainerTerminal[] =>
      sessions.filter((session: ContainerTerminal): boolean => session.id !== id),
    );
    if (this.activeSessionId() === id) {
      this.activeSessionId.set(this.sessionList()[0]?.id ?? null);
    }
  }

  /**
   * Disposes every session's PTY when the Containers tab closes.
   */
  public ngOnDestroy(): void {
    for (const session of this.sessionList()) {
      void this.bridge.dispose(session.id);
    }
  }
}
