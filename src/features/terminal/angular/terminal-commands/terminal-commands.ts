import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  ShellFamily,
  TerminalListing,
  TerminalLocation,
} from '@features/terminal/angular/terminal-commands/shell-commands';

/**
 * Defines the commands the terminal ribbon can invoke on the active terminal.
 */
export interface TerminalCommandHandler {
  /**
   * Gets a value indicating whether scroll lock is engaged, freezing the viewport as output streams.
   */
  readonly scrollLocked: Signal<boolean>;

  /**
   * Gets the command dialect of the shell the terminal is running, which decides the commands the
   * ribbon's listings and locations write.
   */
  readonly shellFamily: Signal<ShellFamily>;

  /**
   * Clears the terminal screen.
   */
  clear(): void;

  /**
   * Destroys the terminal session and respawns a fresh one under the current shell, keeping the same
   * identifier.
   */
  restart(): void;

  /**
   * Starts a fresh session, respawning under the given shell — or the configured default shell when
   * none is given — keeping the same identifier.
   * @param shell The shell executable to run, or undefined for the configured default.
   */
  newSession(shell?: string): void;

  /**
   * Copies the whole buffer to the clipboard, then clears the screen.
   */
  cut(): void;

  /**
   * Copies the current selection (or the whole buffer when nothing is selected) to the clipboard.
   */
  copy(): void;

  /**
   * Pastes the clipboard contents into the terminal.
   */
  paste(): void;

  /**
   * Lists the terminal's current directory the given way, in the running shell's own command.
   * @param listing The listing wanted.
   */
  list(listing: TerminalListing): void;

  /**
   * Opens the terminal's working directory in the operating system's file manager.
   */
  open(): void;

  /**
   * Changes the terminal's working directory to the given location, in the running shell's own
   * command. Does nothing when the shell cannot go there.
   * @param location The location wanted.
   */
  goTo(location: TerminalLocation): void;

  /**
   * Sets whether scroll lock is engaged on the terminal.
   * @param value Whether to engage scroll lock.
   */
  setScrollLock(value: boolean): void;

  /**
   * Scrolls the terminal viewport to the newest output at the bottom of the buffer.
   */
  scrollToBottom(): void;

  /**
   * Opens the find panel over the terminal to search its buffer.
   */
  find(): void;
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
   * Gets a value indicating whether the active terminal has scroll lock engaged. Defaults to false
   * when no terminal is active.
   */
  public readonly scrollLocked: Signal<boolean> = computed(
    (): boolean => this.handler()?.scrollLocked() ?? false,
  );

  /**
   * Gets the command dialect of the active terminal's shell, or null when no terminal is active.
   */
  public readonly shellFamily: Signal<ShellFamily | null> = computed(
    (): ShellFamily | null => this.handler()?.shellFamily() ?? null,
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
   * Invokes the clear command on the active terminal.
   */
  public clear(): void {
    this.handler()?.clear();
  }

  /**
   * Invokes the restart command on the active terminal.
   */
  public restart(): void {
    this.handler()?.restart();
  }

  /**
   * Starts a fresh session on the active terminal, under the given shell or the configured default.
   * @param shell The shell executable to run, or undefined for the configured default.
   */
  public newSession(shell?: string): void {
    this.handler()?.newSession(shell);
  }

  /**
   * Invokes the cut command on the active terminal.
   */
  public cut(): void {
    this.handler()?.cut();
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
   * Lists the active terminal's current directory the given way.
   * @param listing The listing wanted.
   */
  public list(listing: TerminalListing): void {
    this.handler()?.list(listing);
  }

  /**
   * Invokes the open command on the active terminal.
   */
  public open(): void {
    this.handler()?.open();
  }

  /**
   * Changes the active terminal's working directory to the given location.
   * @param location The location wanted.
   */
  public goTo(location: TerminalLocation): void {
    this.handler()?.goTo(location);
  }

  /**
   * Sets whether scroll lock is engaged on the active terminal.
   * @param value Whether to engage scroll lock.
   */
  public setScrollLock(value: boolean): void {
    this.handler()?.setScrollLock(value);
  }

  /**
   * Scrolls the active terminal to the newest output at the bottom of the buffer.
   */
  public scrollToBottom(): void {
    this.handler()?.scrollToBottom();
  }

  /**
   * Opens the find panel over the active terminal to search its buffer.
   */
  public find(): void {
    this.handler()?.find();
  }
}
