import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * Holds the open state of the run-configuration Configure dialog, summoned from the directory ribbon's
 * Configure button and hosted at the application shell. Kept as a small app-level service (mirroring
 * {@link import('../welcome-modal/welcome-modal').WelcomeModal}) so the ribbon can open the dialog
 * without owning its lifetime.
 */
@Service()
export class ConfigureDialog {
  /**
   * Holds the backing open state.
   */
  private readonly openState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether the Configure dialog is open.
   */
  public readonly isOpen: Signal<boolean> = this.openState.asReadonly();

  /**
   * Opens the Configure dialog.
   */
  public open(): void {
    this.openState.set(true);
    this.log.info('ConfigureDialog', 'Configure dialog opened');
  }

  /**
   * Closes the Configure dialog.
   */
  public close(): void {
    this.openState.set(false);
    this.log.info('ConfigureDialog', 'Configure dialog closed');
  }
}
