import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * A handle a terminal view registers so callers can read its on-screen output without holding a
 * reference to the view itself.
 */
export interface TerminalHandle {
  /**
   * Reads the terminal's current buffer as plain text.
   * @returns Returns the terminal buffer contents.
   */
  readText(): string;
}

/**
 * A registry of live terminals, keyed by terminal (tab) identifier. Each terminal view registers a
 * {@link TerminalHandle} once it is ready and unregisters it on destroy, so the terminal agent's
 * capabilities can read a specific terminal's output by id without reaching into the view.
 */
@Service()
export class Terminals {
  /**
   * Holds the registered terminal handles, keyed by terminal identifier.
   */
  private readonly handles: Map<string, TerminalHandle> = new Map<string, TerminalHandle>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Registers a terminal's handle.
   * @param id The terminal identifier.
   * @param handle The handle exposing the terminal's output.
   */
  public register(id: string, handle: TerminalHandle): void {
    this.handles.set(id, handle);
    this.log.trace('Terminals', 'Registered terminal handle', id);
  }

  /**
   * Unregisters a terminal's handle. Called when the terminal is destroyed.
   * @param id The terminal identifier.
   */
  public unregister(id: string): void {
    this.handles.delete(id);
    this.log.trace('Terminals', 'Unregistered terminal handle', id);
  }

  /**
   * Reads a terminal's current output by identifier.
   * @param id The terminal identifier.
   * @returns Returns the terminal's text, or null when no terminal is registered under the id.
   */
  public readText(id: string): string | null {
    return this.handles.get(id)?.readText() ?? null;
  }
}
