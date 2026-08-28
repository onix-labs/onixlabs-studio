import { effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
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
   * Holds the settings store governing whether the lock's switch is carried at all.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Releases the lock whenever its switch is hidden.
   *
   * The switch in the title strip is the only place the lock can be released, so a window left locked
   * without it could never be moved again. The setting therefore governs the lock itself and not
   * merely whether the switch is drawn.
   */
  private readonly releaseWhenHidden: ReturnType<typeof effect> = effect((): void => {
    if (!this.settings.applicationShowWindowLock() && this.lockedState()) {
      this.setLocked(false);
    }
  });

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
