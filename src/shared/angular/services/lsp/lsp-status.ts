import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies the lifecycle state of a language server, as surfaced in the status strip.
 */
export type LspServerState = 'starting' | 'ready' | 'unavailable';

/**
 * How long a server may sit in its starting state before the watchdog gives up on it and marks it
 * unavailable. Readiness is inferred from behavioural signals (first diagnostics, an answered feature
 * request, an initialization notification); a server that starts but never delivers one of those would
 * otherwise spin in the status strip forever. This backstop bounds that wait, leaving the session with
 * its restart affordance rather than an endless spinner. It sits comfortably above the main process's
 * 60-second `initialize` timeout — a genuine handshake failure resolves as unavailable well before the
 * watchdog fires — so this only catches the case where a started server never proves itself ready.
 */
const READINESS_WATCHDOG_MS: number = 120_000;

/**
 * Holds a tracked server's identity, current state, and the callback that restarts it. One entry
 * exists per running session; the owning {@link import('./lsp-client').LspClient} supplies the
 * restart callback so a restart re-opens that client's documents against a fresh server.
 */
interface ServerEntry {
  /**
   * Gets the identifier of the server (for example `typescript`).
   */
  readonly serverId: string;

  /**
   * Gets the absolute root path the server's session is rooted at.
   */
  readonly rootPath: string;

  /**
   * Gets the server's current lifecycle state.
   */
  readonly state: LspServerState;

  /**
   * Gets a reason for the state (for example why the server is unavailable), or undefined.
   */
  readonly detail?: string;

  /**
   * Restarts the server: tears the running session down and re-opens its documents against a new one.
   */
  readonly restart: () => void;
}

/**
 * Describes a running language server as shown in the status strip's drop-up menu.
 */
export interface LspServer {
  /**
   * Gets the session identifier the server is keyed by (`${rootPath}::${serverId}`).
   */
  readonly sessionId: string;

  /**
   * Gets the identifier of the server (for example `typescript`).
   */
  readonly serverId: string;

  /**
   * Gets the language name shown to the user (for example `TypeScript`).
   */
  readonly name: string;

  /**
   * Gets the absolute root path the server's session is rooted at.
   */
  readonly rootPath: string;

  /**
   * Gets the server's current lifecycle state.
   */
  readonly state: LspServerState;

  /**
   * Gets a reason for the state (for example why the server is unavailable), or undefined.
   */
  readonly detail?: string;
}

/**
 * Maps a server identifier to the language name shown to the user.
 */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  java: 'Java',
  python: 'Python',
  csharp: 'C#',
  clangd: 'C/C++',
};

/**
 * Tracks the lifecycle state of every language server the application is running and exposes them to
 * the status strip's drop-up menu. Language-server clients register each server as it starts, report
 * it ready (or unavailable), and remove it when its process exits. Each entry carries the root its
 * session is rooted at, so the menu can scope its list to the active workspace, and a restart callback
 * the menu invokes to bring a server back up. It is a root singleton shared by every workspace's
 * client, so the menu sees every running server wherever it runs.
 */
@Service()
export class LspStatus {
  /**
   * Holds each server's entry, keyed by session identifier.
   */
  private readonly entries: WritableSignal<ReadonlyMap<string, ServerEntry>> = signal<
    ReadonlyMap<string, ServerEntry>
  >(new Map<string, ServerEntry>());

  /**
   * Holds the pending readiness-watchdog timer for each session still in its starting state, so it can
   * be re-armed on a fresh start and cleared once the server settles or is removed.
   */
  private readonly watchdogs: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Gets every running server, ordered by language name then root, for the drop-up menu.
   */
  public readonly servers: Signal<readonly LspServer[]> = computed((): readonly LspServer[] =>
    [...this.entries()]
      .map(
        ([sessionId, entry]: [string, ServerEntry]): LspServer => ({
          sessionId,
          serverId: entry.serverId,
          name: this.name(entry.serverId),
          rootPath: entry.rootPath,
          state: entry.state,
          detail: entry.detail,
        }),
      )
      .sort(
        (first: LspServer, second: LspServer): number =>
          first.name.localeCompare(second.name) || first.rootPath.localeCompare(second.rootPath),
      ),
  );

  /**
   * Registers a server as starting, recording its identity and restart callback. Re-registering an
   * existing session refreshes it back to the starting state (as happens on a restart), keeping its
   * place in the menu.
   * @param sessionId The session the server is keyed by.
   * @param server The server's identity and restart callback.
   */
  public register(
    sessionId: string,
    server: { serverId: string; rootPath: string; restart: () => void },
  ): void {
    const next: Map<string, ServerEntry> = new Map<string, ServerEntry>(this.entries());
    next.set(sessionId, {
      serverId: server.serverId,
      rootPath: server.rootPath,
      state: 'starting',
      restart: server.restart,
    });
    this.entries.set(next);
    this.armWatchdog(sessionId);
  }

  /**
   * Updates a tracked server's state, ignored when the session is not tracked.
   * @param sessionId The session whose state changes.
   * @param state The server's new lifecycle state.
   * @param detail A reason for the state (for example why the server is unavailable), or undefined.
   */
  public setState(sessionId: string, state: LspServerState, detail?: string): void {
    const current: ServerEntry | undefined = this.entries().get(sessionId);
    if (current === undefined) {
      return;
    }
    const next: Map<string, ServerEntry> = new Map<string, ServerEntry>(this.entries());
    next.set(sessionId, { ...current, state, detail });
    this.entries.set(next);
    // A move back into starting (a restart) re-arms the watchdog; settling to ready or unavailable
    // retires it.
    if (state === 'starting') {
      this.armWatchdog(sessionId);
    } else {
      this.clearWatchdog(sessionId);
    }
  }

  /**
   * Gets a tracked server's current lifecycle state, so a client can act only on state transitions
   * (for example refreshing semantic tokens once, when a server first becomes ready).
   * @param sessionId The session whose state is read.
   * @returns Returns the server's state, or null when the session is not tracked.
   */
  public stateOf(sessionId: string): LspServerState | null {
    return this.entries().get(sessionId)?.state ?? null;
  }

  /**
   * Restarts a tracked server through the callback its owning client registered.
   * @param sessionId The session to restart.
   */
  public restart(sessionId: string): void {
    this.entries().get(sessionId)?.restart();
  }

  /**
   * Stops tracking a server, removing it from the menu.
   * @param sessionId The session to remove.
   */
  public remove(sessionId: string): void {
    if (!this.entries().has(sessionId)) {
      return;
    }
    const next: Map<string, ServerEntry> = new Map<string, ServerEntry>(this.entries());
    next.delete(sessionId);
    this.entries.set(next);
    this.clearWatchdog(sessionId);
  }

  /**
   * Arms (or re-arms) the readiness watchdog for a session that has just entered its starting state.
   * When it fires, a session still stuck in starting is marked unavailable so it reads as recoverable
   * (with its restart affordance) rather than spinning forever; a later readiness signal that beats the
   * watchdog clears it via {@link setState}, and a genuinely ready server that answers slowly afterwards
   * still flips itself back to ready.
   * @param sessionId The session to watch.
   */
  private armWatchdog(sessionId: string): void {
    this.clearWatchdog(sessionId);
    this.watchdogs.set(
      sessionId,
      setTimeout((): void => {
        this.watchdogs.delete(sessionId);
        if (this.entries().get(sessionId)?.state === 'starting') {
          this.setState(
            sessionId,
            'unavailable',
            'The server did not report ready in time. Restart it to try again.',
          );
        }
      }, READINESS_WATCHDOG_MS),
    );
  }

  /**
   * Cancels a session's pending readiness watchdog, if any.
   * @param sessionId The session whose watchdog is cleared.
   */
  private clearWatchdog(sessionId: string): void {
    const pending: ReturnType<typeof setTimeout> | undefined = this.watchdogs.get(sessionId);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.watchdogs.delete(sessionId);
    }
  }

  /**
   * Resolves a server identifier to its display name.
   * @param serverId The server identifier.
   * @returns Returns the language name, or the identifier when unknown.
   */
  private name(serverId: string): string {
    return DISPLAY_NAMES[serverId] ?? serverId;
  }
}
