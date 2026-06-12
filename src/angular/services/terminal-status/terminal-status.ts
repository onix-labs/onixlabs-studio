import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { StatusBar, StatusSegment } from '../status-bar/status-bar';

/**
 * Holds the identifier of the working-directory status segment.
 */
const CWD_SEGMENT_ID: string = 'terminal-cwd';

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
      const segments: readonly StatusSegment[] =
        cwd === null ? [] : [{ id: CWD_SEGMENT_ID, text: cwd, icon: 'ti ti-folder' }];
      this.statusBar.setTrailing(segments);
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
