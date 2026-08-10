import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * Owns whether a window is dimmed behind a modal.
 *
 * A modal now lives in its own OS window, so the window it was raised from needs the treatment the
 * in-document overlay used to provide: the content blurs and tints, and stops taking input, until
 * the modal is gone. Modals raise and lower this as they open and close; the count is what matters,
 * because a modal may itself raise a second one (a confirmation over a dialog) and the backdrop must
 * survive the inner one closing — and because a click on the backdrop belongs to the topmost modal
 * alone.
 *
 * One instance exists per window that can raise modals: the root injector's serves the main window,
 * and {@link import('../../components/popout-dock-host/popout-dock-host').PopoutDockHost} provides
 * its own, so a modal raised from a popped-out panel dims THAT window. A modal resolves the right
 * instance simply by being injected where its content lives.
 */
@Service()
export class ModalBackdrop {
  /**
   * Holds the modals currently open over this window, oldest first. Each carries what to do when
   * the user clicks the backdrop, which only the topmost modal answers.
   */
  private readonly modals: WritableSignal<readonly (() => void)[]> = signal<
    readonly (() => void)[]
  >([]);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets a value indicating whether the window is currently behind a modal.
   */
  public readonly raised: Signal<boolean> = computed((): boolean => this.modals().length > 0);

  /**
   * Raises the backdrop over this window.
   * @param dismiss The action to take when the user clicks the backdrop while this modal is the
   * topmost one. A modal that cannot be dismissed this way passes nothing.
   * @returns Returns the disposer that lowers it again. Calling it more than once is harmless.
   */
  public raise(dismiss: () => void = (): void => undefined): () => void {
    this.modals.update((open: readonly (() => void)[]): readonly (() => void)[] => [
      ...open,
      dismiss,
    ]);
    this.log.trace('ModalBackdrop', 'Backdrop raised', this.modals().length);
    let lowered: boolean = false;
    return (): void => {
      if (lowered) {
        return;
      }
      lowered = true;
      this.modals.update((open: readonly (() => void)[]): readonly (() => void)[] =>
        open.filter((entry: () => void): boolean => entry !== dismiss),
      );
      this.log.trace('ModalBackdrop', 'Backdrop lowered', this.modals().length);
    };
  }

  /**
   * Handles the user clicking the backdrop: the topmost modal is asked to dismiss itself, exactly
   * as clicking beside a dialog once did when the modal was drawn inside this window. A modal that
   * may not be dismissed that way simply does nothing.
   */
  public requestDismiss(): void {
    const open: readonly (() => void)[] = this.modals();
    open[open.length - 1]?.();
  }
}
