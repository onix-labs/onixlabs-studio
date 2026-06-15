import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Icon } from '../../icons/icon';

/**
 * Identifies the lifecycle state of a language server, as surfaced in the status strip.
 */
export type LspServerState = 'starting' | 'ready' | 'unavailable';

/**
 * Holds a server's contribution to the status indicator.
 */
interface ServerEntry {
  /**
   * Gets the identifier of the server (for example `typescript`).
   */
  readonly serverId: string;

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
 * Describes the single language-server indicator shown in the status strip.
 */
export interface LspIndicator {
  /**
   * Gets the state the indicator reflects.
   */
  readonly state: LspServerState;

  /**
   * Gets the human-readable label.
   */
  readonly label: string;

  /**
   * Gets the icon shown alongside the label.
   */
  readonly icon: Icon;
}

/**
 * Maps a server identifier to the language name shown to the user.
 */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  java: 'Java',
  python: 'Python',
};

/**
 * Tracks the lifecycle state of the application's language servers and projects a single indicator
 * for the status strip. Language-server clients report each server as it starts, becomes ready, or
 * fails; the indicator favours an in-progress start (so the user sees a server coming up), then a
 * ready server (the connected state), then an unavailable one. It is a root singleton shared by every
 * workspace's client, so the strip shows a consistent state wherever the servers run.
 */
@Service()
export class LspStatus {
  /**
   * Holds each server's state, keyed by session identifier.
   */
  private readonly servers: WritableSignal<ReadonlyMap<string, ServerEntry>> = signal<
    ReadonlyMap<string, ServerEntry>
  >(new Map<string, ServerEntry>());

  /**
   * Gets the single indicator to show, or null when no server is being tracked.
   */
  public readonly indicator: Signal<LspIndicator | null> = computed((): LspIndicator | null => {
    const entries: readonly ServerEntry[] = [...this.servers().values()];
    if (entries.length === 0) {
      return null;
    }
    const starting: ServerEntry | undefined = entries.find(
      (entry: ServerEntry): boolean => entry.state === 'starting',
    );
    if (starting !== undefined) {
      return {
        state: 'starting',
        label: `${this.name(starting.serverId)} Language Server: starting…`,
        icon: Icon.SPINNER,
      };
    }
    const ready: ServerEntry | undefined = entries.find(
      (entry: ServerEntry): boolean => entry.state === 'ready',
    );
    if (ready !== undefined) {
      return {
        state: 'ready',
        label: `${this.name(ready.serverId)} Language Server`,
        icon: Icon.SUCCESS,
      };
    }
    const failed: ServerEntry = entries[0];
    return {
      state: 'unavailable',
      label: failed.detail ?? `${this.name(failed.serverId)} Language Server: unavailable`,
      icon: Icon.WARNING,
    };
  });

  /**
   * Reports a server's current state.
   * @param sessionId The session the state belongs to.
   * @param serverId The identifier of the server.
   * @param state The server's lifecycle state.
   * @param detail A reason for the state (for example why the server is unavailable), or undefined.
   */
  public report(sessionId: string, serverId: string, state: LspServerState, detail?: string): void {
    const next: Map<string, ServerEntry> = new Map<string, ServerEntry>(this.servers());
    next.set(sessionId, { serverId, state, detail });
    this.servers.set(next);
  }

  /**
   * Stops tracking a server, removing its contribution to the indicator.
   * @param sessionId The session to remove.
   */
  public remove(sessionId: string): void {
    if (!this.servers().has(sessionId)) {
      return;
    }
    const next: Map<string, ServerEntry> = new Map<string, ServerEntry>(this.servers());
    next.delete(sessionId);
    this.servers.set(next);
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
