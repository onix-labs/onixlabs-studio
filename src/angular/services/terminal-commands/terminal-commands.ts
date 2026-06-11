import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Defines the commands the terminal ribbon can invoke on the active terminal.
 */
export interface TerminalCommandHandler {
  /**
   * Copies the current selection (or the whole buffer when nothing is selected) to the clipboard.
   */
  copy(): void;

  /**
   * Pastes the clipboard contents into the terminal.
   */
  paste(): void;

  /**
   * Clears the terminal screen.
   */
  clear(): void;

  /**
   * Destroys the terminal session and respawns a fresh one, keeping the same identifier.
   */
  nuke(): void;
}

/**
 * Routes terminal ribbon commands to the active terminal.
 *
 * The active terminal registers its handler here; the ribbon buttons call the matching method, which
 * forwards to the registered handler (or does nothing when no terminal is active).
 */
@Service()
export class TerminalCommands {
  /**
   * Holds the active terminal's command handler, or null when no terminal is active.
   */
  private readonly handler: WritableSignal<TerminalCommandHandler | null> =
    signal<TerminalCommandHandler | null>(null);

  /**
   * Gets a value indicating whether a terminal is currently active.
   */
  public readonly hasActiveTerminal: Signal<boolean> = computed(
    (): boolean => this.handler() !== null,
  );

  /**
   * Registers the active terminal's command handler.
   * @param handler The handler to register.
   */
  public register(handler: TerminalCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters the given command handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: TerminalCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Invokes the copy command on the active terminal.
   */
  public copy(): void {
    this.handler()?.copy();
  }

  /**
   * Invokes the paste command on the active terminal.
   */
  public paste(): void {
    this.handler()?.paste();
  }

  /**
   * Invokes the clear command on the active terminal.
   */
  public clear(): void {
    this.handler()?.clear();
  }

  /**
   * Invokes the nuke command on the active terminal.
   */
  public nuke(): void {
    this.handler()?.nuke();
  }
}
