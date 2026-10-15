import { inject, OnDestroy, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';

/**
 * One tab in the Containers view's output panel: a shell in a container, run in a terminal, or a
 * container's logs, read through the engine's plugin and drawn by Studio (#973).
 */
export interface ContainerTerminal {
  /**
   * Gets the tab's identifier — for a shell, its PTY session's.
   */
  readonly id: string;

  /**
   * Gets the tab label.
   */
  readonly name: string;

  /**
   * Gets what the tab holds.
   */
  readonly kind: 'shell' | 'logs';

  /**
   * Gets the container whose logs a `logs` tab shows.
   */
  readonly containerId?: string;
}

/**
 * Owns the Containers view's output tabs — the logs and shells opened from container rows (P5). A
 * shell reuses the terminal infrastructure: {@link TerminalBridge} spawns a command-backed (`run`) PTY,
 * and the view's `app-terminal` pane attaches to it by id. Logs need no terminal: the engine's plugin
 * reads them (#973). Provided at the view level so the tabs live as long as the Containers tab and are
 * disposed with it.
 */
@Service()
export class ContainerTerminals implements OnDestroy {
  /**
   * Holds the terminal bridge that spawns and tears down the PTY sessions.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the open tabs, in the order they were opened.
   */
  private readonly sessionList: WritableSignal<readonly ContainerTerminal[]> = signal<
    readonly ContainerTerminal[]
  >([]);

  /**
   * Holds the active tab's id, or null when there are none.
   */
  private readonly activeSessionId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the open tabs.
   */
  public readonly sessions: Signal<readonly ContainerTerminal[]> = this.sessionList.asReadonly();

  /**
   * Gets the active tab's id, or null when there are none.
   */
  public readonly activeId: Signal<string | null> = this.activeSessionId.asReadonly();

  /**
   * Opens a new terminal running a command and makes it active. The pane attaches to the spawned PTY
   * by id; a failing command surfaces its error in the terminal.
   * @param name The tab label.
   * @param command The command line to run.
   */
  public open(name: string, command: string): void {
    const id: string = `docker-${crypto.randomUUID()}`;
    this.log.info('containers.terminals', 'Opening terminal', name, command);
    this.sessionList.update(
      (sessions: readonly ContainerTerminal[]): readonly ContainerTerminal[] => [
        ...sessions,
        { id, name, kind: 'shell' },
      ],
    );
    this.activeSessionId.set(id);
    void this.bridge.create({ id, kind: 'run', command });
  }

  /**
   * Opens a tab showing a container's logs, or brings forward the one already open for it.
   * @param name The tab label.
   * @param containerId The container.
   */
  public openLogs(name: string, containerId: string): void {
    const existing: ContainerTerminal | undefined = this.sessionList().find(
      (session: ContainerTerminal): boolean =>
        session.kind === 'logs' && session.containerId === containerId,
    );
    if (existing !== undefined) {
      this.activeSessionId.set(existing.id);
      return;
    }
    const id: string = `logs-${crypto.randomUUID()}`;
    this.log.info('containers.terminals', 'Opening logs', name, containerId);
    this.sessionList.update(
      (sessions: readonly ContainerTerminal[]): readonly ContainerTerminal[] => [
        ...sessions,
        { id, name, kind: 'logs', containerId },
      ],
    );
    this.activeSessionId.set(id);
  }

  /**
   * Activates an open tab.
   * @param id The tab id.
   */
  public activate(id: string): void {
    if (this.sessionList().some((session: ContainerTerminal): boolean => session.id === id)) {
      this.activeSessionId.set(id);
    }
  }

  /**
   * Closes a tab — disposing its PTY when it is a shell — activating a neighbour when it was active.
   * @param id The tab id.
   */
  public close(id: string): void {
    this.log.debug('containers.terminals', 'Closing tab', id);
    if (this.isShell(id)) {
      void this.bridge.dispose(id);
    }
    this.sessionList.update(
      (sessions: readonly ContainerTerminal[]): readonly ContainerTerminal[] =>
        sessions.filter((session: ContainerTerminal): boolean => session.id !== id),
    );
    if (this.activeSessionId() === id) {
      this.activeSessionId.set(this.sessionList()[0]?.id ?? null);
    }
  }

  /**
   * Disposes every shell's PTY when the Containers tab closes.
   */
  public ngOnDestroy(): void {
    for (const session of this.sessionList()) {
      if (session.kind === 'shell') {
        void this.bridge.dispose(session.id);
      }
    }
  }

  /**
   * Determines whether a tab is a shell, with a PTY to dispose.
   * @param id The tab id.
   * @returns Returns true when it is.
   */
  private isShell(id: string): boolean {
    return this.sessionList().some(
      (session: ContainerTerminal): boolean => session.id === id && session.kind === 'shell',
    );
  }
}
