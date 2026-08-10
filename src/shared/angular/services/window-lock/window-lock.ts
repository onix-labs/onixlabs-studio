import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Studio } from '@shared/angular/services/studio/studio';

/**
 * Represents the window-lock state, controlling whether the frameless window may be moved by
 * dragging the title strip. Locking pins the window in its current position.
 */
@Service()
export class WindowLock {
  /**
   * Holds the Studio bridge wrapper used to toggle the window's movability.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the backing state for {@link locked}.
   */
  private readonly lockedState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether the window is locked in its current position.
   */
  public readonly locked: Signal<boolean> = this.lockedState.asReadonly();

  /**
   * Sets whether the window is locked in place, updating the underlying window movability.
   * @param locked True to lock the window in place; false to allow it to be moved.
   */
  public setLocked(locked: boolean): void {
    this.lockedState.set(locked);
    this.studio.setWindowMovable(!locked);
    this.log.info('WindowLock', `Window ${locked ? 'locked' : 'unlocked'}`);
  }

  /**
   * Toggles whether the window is locked in place.
   */
  public toggle(): void {
    this.setLocked(!this.lockedState());
  }
}
