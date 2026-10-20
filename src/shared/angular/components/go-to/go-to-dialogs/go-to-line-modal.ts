import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import type { GoToTarget } from '@shared/angular/services/go-to/go-to-model';
import { GoToPicker } from '../go-to-picker';

/**
 * The Go to Line dialog (#1009), the "Dialogs" Go to style's way of asking for a line: a small form
 * that takes a line, or `line:column`, says which lines there are, and goes there on Go or Enter.
 * The modal gives the field focus as it opens, and closes on Escape or its window's close button.
 */
@Component({
  selector: 'app-go-to-line-modal',
  imports: [Modal, ModalContent, Button, ButtonRow, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './go-to-dialog.scss',
  template: `
    <app-modal [open]="open()" [width]="24" ariaLabel="Go to Line" (dismiss)="dismissed.emit()">
      <ng-template appModalContent>
        <div class="go-to-dialog">
          <h2 class="go-to-dialog__title">Go to Line</h2>
          <app-text-field
            class="go-to-dialog__field"
            [(value)]="picker.query"
            placeholder="Line, or line:column"
            ariaLabel="Line, or line:column"
            (keydown.enter)="commit($event)"
          />
          <p
            class="go-to-dialog__hint"
            [class.go-to-dialog__hint--invalid]="picker.lineEntry().kind === 'invalid'"
            aria-live="polite"
          >
            {{ picker.lineHint() }}
          </p>
          <app-button-row class="go-to-dialog__actions">
            <app-button
              variant="solid"
              label="Go"
              [disabled]="picker.lineEntry().kind !== 'valid'"
              (click)="commit()"
            />
            <app-button label="Cancel" (click)="dismissed.emit()" />
          </app-button-row>
        </div>
      </ng-template>
    </app-modal>
  `,
})
export class GoToLineModal {
  /**
   * Gets a value indicating whether the dialog is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets the number of lines in the document, the range a line must fall in.
   */
  public readonly lineCount: InputSignal<number> = input<number>(1);

  /**
   * Emitted with where to go when a valid line is entered.
   */
  public readonly picked: OutputEmitterRef<GoToTarget> = output<GoToTarget>();

  /**
   * Emitted when the dialog is dismissed without going anywhere.
   */
  public readonly dismissed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the state behind the form: what was typed, and the line it names.
   */
  protected readonly picker: GoToPicker = new GoToPicker(
    (): null => null,
    (): number => this.lineCount(),
  );

  /**
   * Goes to the typed line. Does nothing while what was typed names no line, so it can be corrected.
   * @param event The Enter key's event, cancelled so it cannot reach the editor once it has focus;
   * undefined for the button.
   */
  protected commit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const target: GoToTarget | null = this.picker.lineTarget();
    if (target !== null) {
      this.picked.emit(target);
    }
  }
}
