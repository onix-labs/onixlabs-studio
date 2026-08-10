import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { FormModal } from './form-modal';

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
  imports: [FormModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-form-modal
      [open]="open()"
      heading="Insert Math"
      [width]="30"
      [canSubmit]="valid()"
      (confirmed)="confirm()"
      (cancelled)="cancel()"
    >
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
    </app-form-modal>
  `,
})
export class MarkdownMathModal {
  /**
   * Holds the structured logging client for the insert modal's confirmation.
   */
  private readonly log: Log = inject(Log);

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
    this.log.debug('markdown.insert', 'Math modal confirmed', { block: this.block() });
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
