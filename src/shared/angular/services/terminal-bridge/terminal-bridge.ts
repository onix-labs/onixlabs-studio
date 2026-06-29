import { Service } from '@angular/core';
import { TerminalApi, TerminalCreateOptions, TerminalCreateResult } from '@shared/studio-api';

/**
 * Holds the result returned when a terminal operation is attempted outside Electron.
 */
const UNAVAILABLE_RESULT: TerminalCreateResult = {
  success: false,
  error: 'Terminal is only available when running inside Electron.',
};

/**
 * Represents the renderer-side wrapper around the Electron terminal bridge exposed on
 * `window.studio.terminal`.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the
 * bridge is absent and every operation degrades to a safe no-op so callers never throw.
 */
@Service()
export class TerminalBridge {
  /**
   * Holds the terminal bridge, or undefined when running outside Electron.
   */
  private readonly api: TerminalApi | undefined = window.studio?.terminal;

  /**
   * Gets a value indicating whether a real terminal bridge is available (i.e. running in Electron).
   */
  public readonly isElectron: boolean = this.api !== undefined;

  /**
   * Spawns a new pseudo-terminal session.
   * @param options The terminal creation options.
   * @returns Returns the result describing success and the spawned shell.
   */
  public create(options: TerminalCreateOptions): Promise<TerminalCreateResult> {
    return this.api?.create(options) ?? Promise.resolve(UNAVAILABLE_RESULT);
  }

  /**
   * Writes input data to a session.
   * @param id The terminal identifier.
   * @param data The data to write.
   * @returns Returns true when the session exists and the data was written.
   */
  public write(id: string, data: string): Promise<boolean> {
    return this.api?.write(id, data) ?? Promise.resolve(false);
  }

  /**
   * Resizes a session.
   * @param id The terminal identifier.
   * @param cols The new column count.
   * @param rows The new row count.
   * @returns Returns true when the session exists and was resized.
   */
  public resize(id: string, cols: number, rows: number): Promise<boolean> {
    return this.api?.resize(id, cols, rows) ?? Promise.resolve(false);
  }

  /**
   * Disposes (kills) a session.
   * @param id The terminal identifier.
   * @returns Returns true when the session existed and was disposed.
   */
  public dispose(id: string): Promise<boolean> {
    return this.api?.dispose(id) ?? Promise.resolve(false);
  }

  /**
   * Gets the current working directory of a session.
   * @param id The terminal identifier.
   * @returns Returns the working directory, or null when it cannot be determined.
   */
  public getCwd(id: string): Promise<string | null> {
    return this.api?.getCwd(id) ?? Promise.resolve(null);
  }

  /**
   * Subscribes to output data from sessions.
   * @param listener Receives the terminal id and the output data chunk.
   * @returns Returns a function that removes the listener.
   */
  public onData(listener: (id: string, data: string) => void): () => void {
    return this.api?.onData(listener) ?? ((): void => undefined);
  }

  /**
   * Subscribes to session exit notifications.
   * @param listener Receives the terminal id, exit code, and signal (or null).
   * @returns Returns a function that removes the listener.
   */
  public onExit(
    listener: (id: string, exitCode: number, signal: number | null) => void,
  ): () => void {
    return this.api?.onExit(listener) ?? ((): void => undefined);
  }
}
