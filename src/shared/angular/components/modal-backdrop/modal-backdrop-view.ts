import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';

/**
 * Renders the dimmed, blurred layer over a window while a modal window is open over it — the
 * backdrop the in-document modal used to draw around its panel, now with nothing in front of it
 * because the panel lives in its own window.
 *
 * It also swallows input: while it is up, the window behind is inert (its title bar still moves the
 * window, which is what a user expects of a dialog's parent). Mounted once per window that can raise
 * modals — the shell mounts it for the main window, and the pop-out dock host for each pop-out —
 * and driven by whichever {@link ModalBackdrop} that window resolves.
 */
@Component({
  selector: 'app-modal-backdrop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: {
    '[class.modal-backdrop--raised]': 'backdrop.raised()',
    'aria-hidden': 'true',
  },
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: none;
        background: transparent;
        backdrop-filter: blur(0);
      }

      // Raised: the tint and blur fade in. The transition lives here, not on the base, so it runs
      // only on entry — lowering reverts to the (untransitioned) base state instantly, matching the
      // modal window's own appearance and disappearance.
      :host(.modal-backdrop--raised) {
        display: block;
        background: var(--modal-backdrop-color);
        backdrop-filter: blur(var(--modal-backdrop-blur));
        transition:
          background var(--modal-fade-duration) ease,
          backdrop-filter var(--modal-fade-duration) ease;

        @starting-style {
          background: transparent;
          backdrop-filter: blur(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host(.modal-backdrop--raised) {
          transition: none;
        }
      }
    `,
  ],
})
export class ModalBackdropView {
  /**
   * Holds this window's backdrop state.
   */
  protected readonly backdrop: ModalBackdrop = inject(ModalBackdrop);
}
