import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Owns whether a window is dimmed behind a modal.
 *
 * A modal now lives in its own OS window, so the window it was raised from needs the treatment the
 * in-document overlay used to provide: the content blurs and tints, and stops taking input, until
 * the modal is gone. Modals raise and lower this as they open and close; the count is what matters,
 * because a modal may itself raise a second one (a confirmation over a dialog) and the backdrop must
 * survive the inner one closing.
 *
 * One instance exists per window that can raise modals: the root injector's serves the main window,
 * and {@link import('../../components/popout-dock-host/popout-dock-host').PopoutDockHost} provides
 * its own, so a modal raised from a popped-out panel dims THAT window. A modal resolves the right
 * instance simply by being injected where its content lives.
 */
@Service()
export class ModalBackdrop {
  /**
   * Holds how many modal windows are currently open over this window.
   */
  private readonly count: WritableSignal<number> = signal<number>(0);

  /**
   * Gets a value indicating whether the window is currently behind a modal.
   */
  public readonly raised: Signal<boolean> = computed((): boolean => this.count() > 0);

  /**
   * Raises the backdrop over this window.
   * @returns Returns the disposer that lowers it again. Calling it more than once is harmless.
   */
  public raise(): () => void {
    this.count.update((value: number): number => value + 1);
    let lowered: boolean = false;
    return (): void => {
      if (lowered) {
        return;
      }
      lowered = true;
      this.count.update((value: number): number => Math.max(0, value - 1));
    };
  }
}
