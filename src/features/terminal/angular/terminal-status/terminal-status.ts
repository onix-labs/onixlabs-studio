import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Holds the identifier of the terminal-type (shell) status segment.
 */
const SHELL_SEGMENT_ID: string = 'terminal-shell';

/**
 * Holds the status-bar owner identifier for the terminal's contribution.
 */
const STATUS_OWNER: string = 'terminal';

/**
 * Holds the status-bar priority for the terminal, ordering its trailing shell segment after the code
 * editor's cursor/encoding segments.
 */
const STATUS_PRIORITY: number = 20;

/**
 * Publishes the active terminal's shell (its terminal type) to the status strip.
 *
 * The active terminal pushes the shell it is running here; an effect projects it as a trailing status
 * segment, clearing the segment when no terminal is active (the shell is null).
 */
@Service()
export class TerminalStatus {
  /**
   * Holds the status bar the shell is published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active terminal's shell name, or null when no terminal is active.
   */
  private readonly shellSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the active terminal's shell name, or null when no terminal is active.
   */
  public readonly shell: Signal<string | null> = this.shellSignal.asReadonly();

  /**
   * Initializes the service, projecting the shell as a trailing status segment.
   */
  public constructor() {
    effect((): void => {
      const shell: string | null = this.shellSignal();
      if (shell === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      this.statusBar.contribute(
        STATUS_OWNER,
        { leading: [], trailing: [{ id: SHELL_SEGMENT_ID, text: shell, icon: Icon.TERMINAL }] },
        STATUS_PRIORITY,
      );
    });
  }

  /**
   * Sets the active terminal's shell name.
   * @param shell The shell name, or null to clear it.
   */
  public setShell(shell: string | null): void {
    this.shellSignal.set(shell);
  }
}
