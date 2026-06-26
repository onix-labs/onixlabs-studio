import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { StatusBar } from '../status-bar/status-bar';
import { Icon } from '../../icons/icon';

/**
 * Holds the identifier of the working-directory status segment.
 */
const CWD_SEGMENT_ID: string = 'terminal-cwd';

/**
 * Holds the status-bar owner identifier for the terminal's contribution.
 */
const STATUS_OWNER: string = 'terminal';

/**
 * Holds the status-bar priority for the terminal, ordering its trailing working-directory segment
 * after the code editor's cursor/encoding segments.
 */
const STATUS_PRIORITY: number = 20;

/**
 * Publishes the active terminal's working directory to the status strip.
 *
 * The active terminal pushes its current working directory here; an effect projects it as a trailing
 * status segment, clearing the segment when no terminal is active (cwd is null).
 */
@Service()
export class TerminalStatus {
  /**
   * Holds the status bar the working directory is published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active terminal's working directory, or null when no terminal is active.
   */
  private readonly cwdSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the active terminal's working directory, or null when no terminal is active.
   */
  public readonly cwd: Signal<string | null> = this.cwdSignal.asReadonly();

  /**
   * Initializes the service, projecting the working directory as a trailing status segment.
   */
  public constructor() {
    effect((): void => {
      const cwd: string | null = this.cwdSignal();
      if (cwd === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      this.statusBar.contribute(
        STATUS_OWNER,
        { leading: [], trailing: [{ id: CWD_SEGMENT_ID, text: cwd, icon: Icon.FOLDER }] },
        STATUS_PRIORITY,
      );
    });
  }

  /**
   * Sets the active terminal's working directory.
   * @param cwd The working directory, or null to clear it.
   */
  public setCwd(cwd: string | null): void {
    this.cwdSignal.set(cwd);
  }
}
