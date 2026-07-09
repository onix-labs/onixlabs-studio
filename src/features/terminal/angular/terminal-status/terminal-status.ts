import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Holds the identifier of the terminal address (its prompt title) status segment.
 */
const ADDRESS_SEGMENT_ID: string = 'terminal-address';

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
 * Publishes the active terminal's address (its full prompt title, e.g. `user@host:~/path`) and shell
 * (its terminal type) to the status strip.
 *
 * The active terminal pushes both here; an effect projects the address as a leading segment and the
 * shell as a trailing segment, clearing the contribution when no terminal is active (both are null).
 */
@Service()
export class TerminalStatus {
  /**
   * Holds the status bar the terminal segments are published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active terminal's address (its full prompt title), or null when no terminal is active.
   */
  private readonly addressSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the active terminal's shell name, or null when no terminal is active.
   */
  private readonly shellSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the active terminal's address (its full prompt title), or null when no terminal is active.
   */
  public readonly address: Signal<string | null> = this.addressSignal.asReadonly();

  /**
   * Gets the active terminal's shell name, or null when no terminal is active.
   */
  public readonly shell: Signal<string | null> = this.shellSignal.asReadonly();

  /**
   * Initializes the service, projecting the address as a leading segment and the shell as a trailing
   * segment.
   */
  public constructor() {
    effect((): void => {
      const address: string | null = this.addressSignal();
      const shell: string | null = this.shellSignal();
      if (address === null && shell === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      this.statusBar.contribute(
        STATUS_OWNER,
        {
          leading: address === null ? [] : [{ id: ADDRESS_SEGMENT_ID, text: address }],
          trailing: shell === null ? [] : [{ id: SHELL_SEGMENT_ID, text: shell, icon: Icon.TERMINAL }],
        },
        STATUS_PRIORITY,
      );
    });
  }

  /**
   * Sets the active terminal's address (its full prompt title).
   * @param address The address, or null to clear it.
   */
  public setAddress(address: string | null): void {
    this.addressSignal.set(address);
  }

  /**
   * Sets the active terminal's shell name.
   * @param shell The shell name, or null to clear it.
   */
  public setShell(shell: string | null): void {
    this.shellSignal.set(shell);
  }
}
