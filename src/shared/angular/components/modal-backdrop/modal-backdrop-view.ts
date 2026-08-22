import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';

/**
 * Renders the dimmed, blurred layer over a window while a modal window is open over it — the
 * backdrop the in-document modal used to draw around its panel, now with nothing in front of it
 * because the panel lives in its own window.
 *
 * It also swallows input: while it is up, the window behind is inert (its title bar still moves the
 * window, which is what a user expects of a dialog's parent). Clicking it dismisses the modal above
 * — the same gesture as clicking beside a dialog when modals were drawn inside this window — which
 * a modal that may not be dismissed that way simply ignores. One click is enough even though the
 * window is not the focused one: application windows accept the click that activates them (see
 * `acceptFirstMouse` in the window manager), so the click that reaches past the modal is also the
 * click that dismisses it.
 *
 * Mounted once per window that can raise modals — the shell mounts it for the main window, and the
 * pop-out dock host for each pop-out — and driven by whichever {@link ModalBackdrop} that window
 * resolves.
 */
@Component({
  selector: 'app-modal-backdrop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: {
    '[class.modal-backdrop--raised]': 'backdrop.raised()',
    '(click)': 'backdrop.requestDismiss()',
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
        backdrop-filter: var(--modal-backdrop-filter);
        transition: var(--modal-backdrop-transition);

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
