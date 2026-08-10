import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the open state of the welcome screen when it is summoned as a modal over the existing
 * content (for example from the title strip's new-tab button). At a cold start the welcome screen is
 * shown regardless because no tabs are open; this state governs the on-demand modal presentation.
 */
@Service()
export class WelcomeModal {
  /**
   * Holds the backing state for {@link isOpen}.
   */
  private readonly openState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets a value indicating whether the welcome modal has been explicitly opened over the content.
   */
  public readonly isOpen: Signal<boolean> = this.openState.asReadonly();

  /**
   * Opens the welcome modal over the existing content.
   */
  public open(): void {
    this.openState.set(true);
    this.log.info('WelcomeModal', 'Welcome modal opened');
  }

  /**
   * Closes the welcome modal. The welcome screen may still be shown if no tabs are open.
   */
  public close(): void {
    this.openState.set(false);
    this.log.info('WelcomeModal', 'Welcome modal closed');
  }

  /**
   * Toggles the welcome modal's open state.
   */
  public toggle(): void {
    this.openState.update((open: boolean): boolean => !open);
  }
}
