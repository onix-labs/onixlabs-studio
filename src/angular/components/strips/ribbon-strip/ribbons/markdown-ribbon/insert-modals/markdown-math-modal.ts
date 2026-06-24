import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Modal } from '../../../../../shared/modal/modal';

/**
 * Describes a math expression to insert and whether it is a block or inline formula.
 */
export interface MathInsert {
  /**
   * Gets the LaTeX expression.
   */
  readonly expression: string;

  /**
   * Gets a value indicating whether to insert a block formula ($$…$$) rather than inline ($…$).
   */
  readonly block: boolean;
}

/**
 * Prompts for a LaTeX expression and whether it is block or inline, then emits the values to insert.
 * Hosted by the markdown ribbon's Insert group.
 */
@Component({
  selector: 'app-markdown-math-modal',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-modal [open]="open()" [width]="30" ariaLabel="Insert math" (dismiss)="cancel()">
      <h2 class="insert-modal__title">Insert math</h2>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="math-expression">LaTeX expression</label>
        <textarea
          #expressionInput
          id="math-expression"
          class="insert-modal__textarea"
          placeholder="\\frac{a}{b}"
          [value]="expression()"
          (input)="expression.set(expressionInput.value)"
        ></textarea>
      </div>

      <div class="insert-modal__choice">
        <label class="insert-modal__choice-option">
          <input type="radio" name="math-mode" [checked]="block()" (change)="block.set(true)" />
          Block
        </label>
        <label class="insert-modal__choice-option">
          <input type="radio" name="math-mode" [checked]="!block()" (change)="block.set(false)" />
          Inline
        </label>
      </div>

      <div class="insert-modal__actions">
        <button type="button" class="insert-modal__button" (click)="cancel()">Cancel</button>
        <button
          type="button"
          class="insert-modal__button insert-modal__button--primary"
          [disabled]="!valid()"
          (click)="confirm()"
        >
          Insert
        </button>
      </div>
    </app-modal>
  `,
})
export class MarkdownMathModal {
  /**
   * Gets a value indicating whether the modal is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Emitted when the modal is dismissed without inserting.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted with the math expression to insert when the user confirms.
   */
  public readonly submitted: OutputEmitterRef<MathInsert> = output<MathInsert>();

  /**
   * Holds the LaTeX expression field value.
   */
  protected readonly expression: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether a block formula is selected (the default), as opposed to inline.
   */
  protected readonly block: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets a value indicating whether the form can be submitted (an expression is present).
   */
  protected readonly valid: Signal<boolean> = computed(
    (): boolean => this.expression().trim().length > 0,
  );

  /**
   * Confirms the dialog, emitting the expression and resetting the fields.
   */
  protected confirm(): void {
    if (!this.valid()) {
      return;
    }
    this.submitted.emit({ expression: this.expression().trim(), block: this.block() });
    this.reset();
    this.closed.emit();
  }

  /**
   * Cancels the dialog, resetting the fields.
   */
  protected cancel(): void {
    this.reset();
    this.closed.emit();
  }

  /**
   * Clears the fields so the next open starts fresh.
   */
  private reset(): void {
    this.expression.set('');
    this.block.set(true);
  }
}
