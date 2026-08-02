import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  ShellInfo,
  TerminalChannel,
  TerminalCreateOptions,
  TerminalCreateResult,
  TerminalReplay,
} from '@shared/api/terminal-channels';

/**
 * Holds the result returned when a terminal operation is attempted outside Electron.
 */
const UNAVAILABLE_RESULT: TerminalCreateResult = {
  success: false,
  error: 'Terminal is only available when running inside Electron.',
};

/**
 * Holds the empty snapshot returned when a replay is requested outside Electron.
 */
const EMPTY_REPLAY: TerminalReplay = { data: '', seq: 0, exitCode: null, signal: null };

/**
 * Represents the renderer-side terminal client: the typed wrapper around the pty IPC channels, driven
 * over the generic {@link Bridge} transport (`window.bridge`). It is the terminal slice of the old
 * `window.studio`, naming its channels from the shared {@link TerminalChannel} contract.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the
 * bridge is absent and every operation degrades to a safe no-op so callers never throw.
 */
@Service()
export class TerminalBridge {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets a value indicating whether a real bridge is available (i.e. running in Electron).
   */
  public readonly isElectron: boolean = this.bridge !== undefined;

  /**
   * Spawns a new pseudo-terminal session.
   * @param options The terminal creation options.
   * @returns Returns the result describing success and the spawned shell.
   */
  public create(options: TerminalCreateOptions): Promise<TerminalCreateResult> {
    return (
      this.bridge?.invoke<TerminalCreateResult>(TerminalChannel.Create, options) ??
      Promise.resolve(UNAVAILABLE_RESULT)
    );
  }

  /**
   * Writes input data to a session.
   * @param id The terminal identifier.
   * @param data The data to write.
   * @returns Returns true when the session exists and the data was written.
   */
  public write(id: string, data: string): Promise<boolean> {
    return this.bridge?.invoke<boolean>(TerminalChannel.Write, id, data) ?? Promise.resolve(false);
  }

  /**
   * Resizes a session.
   * @param id The terminal identifier.
   * @param cols The new column count.
   * @param rows The new row count.
   * @returns Returns true when the session exists and was resized.
   */
  public resize(id: string, cols: number, rows: number): Promise<boolean> {
    return (
      this.bridge?.invoke<boolean>(TerminalChannel.Resize, id, cols, rows) ?? Promise.resolve(false)
    );
  }

  /**
   * Disposes (kills) a session.
   * @param id The terminal identifier.
   * @returns Returns true when the session existed and was disposed.
   */
  public dispose(id: string): Promise<boolean> {
    return this.bridge?.invoke<boolean>(TerminalChannel.Dispose, id) ?? Promise.resolve(false);
  }

  /**
   * Terminates a session's process tree (SIGTERM escalating to SIGKILL) while keeping the session
   * and its scrollback — stop what runs, without removing the tab.
   * @param id The terminal identifier.
   * @returns Returns true when the session exists and was signalled.
   */
  public terminate(id: string): Promise<boolean> {
    return this.bridge?.invoke<boolean>(TerminalChannel.Terminate, id) ?? Promise.resolve(false);
  }

  /**
   * Gets the current working directory of a session.
   * @param id The terminal identifier.
   * @returns Returns the working directory, or null when it cannot be determined.
   */
  public getCwd(id: string): Promise<string | null> {
    return this.bridge?.invoke<string | null>(TerminalChannel.GetCwd, id) ?? Promise.resolve(null);
  }

  /**
   * Lists the shells installed on the host, for the shell picker.
   * @returns Returns the installed shells, most-preferred first, or an empty list outside Electron.
   */
  public listShells(): Promise<readonly ShellInfo[]> {
    return (
      this.bridge?.invoke<readonly ShellInfo[]>(TerminalChannel.ListShells) ?? Promise.resolve([])
    );
  }

  /**
   * Reads a session's retained scrollback snapshot, so a re-attaching pane can replay the output it
   * missed while unmounted.
   * @param id The terminal identifier.
   * @returns Returns the snapshot, or an empty snapshot outside Electron (or for an unknown session).
   */
  public replay(id: string): Promise<TerminalReplay> {
    return (
      this.bridge?.invoke<TerminalReplay>(TerminalChannel.Replay, id) ??
      Promise.resolve(EMPTY_REPLAY)
    );
  }

  /**
   * Holds the per-session data listeners. All sessions' chunks arrive on ONE bridge channel; with a
   * listener per pane each chunk from any session would invoke every pane's callback (M panes × all
   * traffic), so chunks are dispatched here by session id — one bridge subscription, one callback
   * invocation per chunk.
   */
  private readonly dataListeners: Map<string, Set<(data: string, seq: number) => void>> = new Map<
    string,
    Set<(data: string, seq: number) => void>
  >();

  /**
   * Holds the disposer of the single underlying data subscription, or null while none is active.
   */
  private dataSubscription: (() => void) | null = null;

  /**
   * Subscribes to one session's output data.
   * @param id The terminal identifier whose chunks to receive.
   * @param listener Receives each output chunk and its sequence number in the session's output
   * stream (used to reconcile live chunks with a replay snapshot).
   * @returns Returns a function that removes the listener.
   */
  public onDataFor(id: string, listener: (data: string, seq: number) => void): () => void {
    if (this.bridge === undefined) {
      return (): void => undefined;
    }
    this.dataSubscription ??= this.bridge.on(TerminalChannel.Data, (...args: unknown[]): void => {
      const listeners: Set<(data: string, seq: number) => void> | undefined =
        this.dataListeners.get(args[0] as string);
      if (listeners !== undefined) {
        for (const callback of listeners) {
          callback(args[1] as string, args[2] as number);
        }
      }
    });
    let listeners: Set<(data: string, seq: number) => void> | undefined = this.dataListeners.get(id);
    if (listeners === undefined) {
      listeners = new Set<(data: string, seq: number) => void>();
      this.dataListeners.set(id, listeners);
    }
    listeners.add(listener);
    return (): void => {
      const current: Set<(data: string, seq: number) => void> | undefined =
        this.dataListeners.get(id);
      current?.delete(listener);
      if (current?.size === 0) {
        this.dataListeners.delete(id);
      }
    };
  }

  /**
   * Subscribes to session exit notifications.
   * @param listener Receives the terminal id, exit code, and signal (or null).
   * @returns Returns a function that removes the listener.
   */
  public onExit(
    listener: (id: string, exitCode: number, signal: number | null) => void,
  ): () => void {
    return (
      this.bridge?.on(TerminalChannel.Exit, (...args: unknown[]): void =>
        listener(args[0] as string, args[1] as number, args[2] as number | null),
      ) ?? ((): void => undefined)
    );
  }
}
