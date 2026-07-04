import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Modal } from '@shared/angular/components/modal/modal';

/**
 * Represents the shared chrome for the markdown Insert group's field modals. It wraps the reusable
 * {@link Modal} panel with the heading, the projected field content, and the Cancel / primary action
 * buttons, so each insert modal supplies only its own fields and validity — the open/dismiss wiring,
 * the title, and the action row live here in one place.
 */
@Component({
  selector: 'app-form-modal',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-modal
      [open]="open()"
      [width]="width()"
      [ariaLabel]="heading()"
      (dismiss)="cancelled.emit()"
    >
      <h2 class="insert-modal__title">{{ heading() }}</h2>

      <ng-content />

      <div class="insert-modal__actions">
        <button type="button" class="insert-modal__button" (click)="cancelled.emit()">
          Cancel
        </button>
        <button
          type="button"
          class="insert-modal__button insert-modal__button--primary"
          [disabled]="!canSubmit()"
          (click)="confirmed.emit()"
        >
          {{ submitLabel() }}
        </button>
      </div>
    </app-modal>
  `,
})
export class FormModal {
  /**
   * Gets a value indicating whether the modal is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets the heading shown at the top of the modal and used as its accessible label.
   */
  public readonly heading: InputSignal<string> = input.required<string>();

  /**
   * Gets the modal width in rem.
   */
  public readonly width: InputSignal<number> = input<number>(30);

  /**
   * Gets a value indicating whether the primary action is enabled.
   */
  public readonly canSubmit: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the label shown on the primary action button.
   */
  public readonly submitLabel: InputSignal<string> = input<string>('Insert');

  /**
   * Emitted when the user activates the primary action. The host builds and emits its payload.
   */
  public readonly confirmed: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted when the modal is dismissed via Cancel or the backdrop.
   */
  public readonly cancelled: OutputEmitterRef<void> = output<void>();
}
