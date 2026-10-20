import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  OnInit,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { GoToPicker } from '../go-to-picker';

/**
 * The Rename Symbol dialog (#1015), the "Dialogs" Go to style's way of asking for a symbol's new
 * name: a small form that opens holding the name as it stands — selected, as the modal selects a
 * prefilled field, so typing replaces it — and renames on Rename or Enter. It closes on Escape or its
 * window's close button.
 */
@Component({
  selector: 'app-rename-symbol-modal',
  imports: [Modal, ModalContent, Button, ButtonRow, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './go-to-dialog.scss',
  template: `
    <app-modal [open]="open()" [width]="26" ariaLabel="Rename Symbol" (dismiss)="dismissed.emit()">
      <ng-template appModalContent>
        <div class="go-to-dialog">
          <h2 class="go-to-dialog__title">Rename Symbol</h2>
          <app-text-field
            class="go-to-dialog__field"
            [(value)]="picker.query"
            placeholder="New name"
            ariaLabel="New name"
            (keydown.enter)="commit($event)"
          />
          <p
            class="go-to-dialog__hint"
            [class.go-to-dialog__hint--invalid]="
              picker.renameEntry().name === null && picker.query().trim().length > 0
            "
            aria-live="polite"
          >
            {{ picker.renameEntry().hint }}
          </p>
          <app-button-row class="go-to-dialog__actions">
            <app-button
              variant="solid"
              label="Rename"
              [disabled]="picker.renameEntry().name === null"
              (click)="commit()"
            />
            <app-button label="Cancel" (click)="dismissed.emit()" />
          </app-button-row>
        </div>
      </ng-template>
    </app-modal>
  `,
})
export class RenameSymbolModal implements OnInit {
  /**
   * Gets a value indicating whether the dialog is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets the symbol's name as it stands, which the field opens holding.
   */
  public readonly currentName: InputSignal<string> = input<string>('');

  /**
   * Emitted with the new name when one is entered.
   */
  public readonly renamed: OutputEmitterRef<string> = output<string>();

  /**
   * Emitted when the dialog is dismissed without renaming.
   */
  public readonly dismissed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the state behind the form: what was typed, and the new name it gives.
   */
  protected readonly picker: GoToPicker = new GoToPicker(
    (): null => null,
    (): number => 1,
    (): string => this.currentName(),
  );

  /**
   * Fills the field with the symbol's name as the dialog opens.
   */
  public ngOnInit(): void {
    this.picker.query.set(this.currentName());
  }

  /**
   * Renames to the typed name. Does nothing while what was typed gives no new name, so it can be
   * corrected.
   * @param event The Enter key's event, cancelled so it cannot reach the editor once it has focus;
   * undefined for the button.
   */
  protected commit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const name: string | null = this.picker.renameEntry().name;
    if (name !== null) {
      this.renamed.emit(name);
    }
  }
}
