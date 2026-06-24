import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../icon/app-icon';

/**
 * Represents a reusable modal: a full-bleed backdrop centring a panel over the application content.
 *
 * The modal owns the backdrop, the show/hide animation, and the dismissal behaviour; callers project
 * their content into the panel and drive the open state. It supports two modes: a dismissable modal
 * (closed by clicking the backdrop, pressing Escape, or using the corner close button) and a blocking
 * modal (closed only by an action the projected content provides).
 *
 * The panel and backdrop are themed through CSS custom properties (`--modal-panel-*`,
 * `--modal-backdrop-*`), consumed with sensible card defaults so a bare modal looks right while a
 * caller such as the welcome screen can override them for a bespoke presentation. A decorative layer
 * (for example the welcome screen's drifting orbs) can be projected behind the panel via the
 * `modalBackdrop` slot.
 */
@Component({
  selector: 'app-modal',
  imports: [AppIcon],
  templateUrl: './modal.html',
  styleUrl: './modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class Modal {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets a value indicating whether the modal is shown. The overlay stays mounted so it can animate
   * in and out; this drives its visible state.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets a value indicating whether the modal can be dismissed by the user. When true it closes on a
   * backdrop click, the Escape key, or the corner close button; when false it can only be closed by
   * an action the projected content provides.
   */
  public readonly dismissable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the corner close button is rendered. It only ever appears when
   * the modal is also dismissable.
   */
  public readonly showClose: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the accessible label announced for the dialog, or undefined to leave it unlabelled.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the panel width in rem (for example 30 for a 30rem-wide modal), used to size small, medium,
   * and large modals. The width is capped to the viewport so narrow screens never overflow. When
   * undefined the panel falls back to its themed default width.
   */
  public readonly width: InputSignal<number | undefined> = input<number>();

  /**
   * Gets the resolved panel inline-size, or null to defer to the themed default. Capped at the
   * viewport width so the panel stays responsive.
   */
  protected readonly panelInlineSize: Signal<string | null> = computed((): string | null => {
    const width: number | undefined = this.width();
    return width === undefined ? null : `min(${width}rem, 100%)`;
  });

  /**
   * Gets a value indicating whether the backdrop acts as a window-drag region. This is used for the
   * frameless cold-start presentation where there is no title strip to move the window by; the panel
   * and its controls always opt back out so they stay interactive.
   */
  public readonly draggableBackdrop: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emitted when the user dismisses the modal via the backdrop, the Escape key, or the close button.
   * The caller owns the open state and is responsible for acting on this.
   */
  public readonly dismiss: OutputEmitterRef<void> = output<void>();

  /**
   * Requests dismissal, emitting only when the modal is currently dismissable.
   */
  protected requestDismiss(): void {
    if (this.dismissable()) {
      this.dismiss.emit();
    }
  }

  /**
   * Handles a click on the backdrop, requesting dismissal only when the click falls on the backdrop
   * itself rather than bubbling up from the panel.
   * @param event The originating click event.
   */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.requestDismiss();
    }
  }

  /**
   * Handles the Escape key, requesting dismissal when the modal is open.
   */
  protected onEscape(): void {
    if (this.open()) {
      this.requestDismiss();
    }
  }
}
