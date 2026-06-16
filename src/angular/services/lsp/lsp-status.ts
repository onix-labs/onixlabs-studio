import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies the lifecycle state of a language server, as surfaced in the status strip.
 */
export type LspServerState = 'starting' | 'ready' | 'unavailable';

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
