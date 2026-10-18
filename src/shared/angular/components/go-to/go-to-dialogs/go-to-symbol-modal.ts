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
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import type { GoToSymbol, GoToTarget } from '@shared/angular/services/go-to/go-to-model';
import { GoToPicker } from '../go-to-picker';

/**
 * The Go to Symbol dialog (#1009), the "Dialogs" Go to style's way of asking for a symbol: a search
 * field over a list of the document's symbols, each with its kind's icon and what it is declared in.
 * Typing filters the list; ↑ and ↓ move through it, and Go, Enter or a click goes to the symbol.
 */
@Component({
  selector: 'app-go-to-symbol-modal',
  imports: [Modal, ModalContent, Button, ButtonRow, TextField, AppIcon, ListView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './go-to-dialog.scss',
  template: `
    <app-modal [open]="open()" [width]="34" ariaLabel="Go to Symbol" (dismiss)="dismissed.emit()">
      <ng-template appModalContent>
        <div class="go-to-dialog">
          <h2 class="go-to-dialog__title">Go to Symbol</h2>
          <app-text-field
            class="go-to-dialog__field"
            kind="search"
            [(value)]="picker.query"
            placeholder="Symbol name"
            ariaLabel="Symbol name"
            (keydown.enter)="commit($event)"
            (keydown.arrowdown)="step($event, 1)"
            (keydown.arrowup)="step($event, -1)"
          />
          @if (symbols() === null) {
            <p class="go-to-dialog__hint" aria-live="polite">Reading the file's symbols…</p>
          } @else {
            <app-list-view
              class="go-to-dialog__list"
              [rows]="picker.rows()"
              [selectedId]="picker.selectedId()"
              [emptyText]="picker.emptyText()"
              (rowClick)="pick($event)"
            >
              <ng-template let-row>
                @let symbol = symbolOf(row);
                <app-icon class="go-to-dialog__icon" [icon]="symbol.icon" aria-hidden="true" />
                <span class="go-to-dialog__name">{{ symbol.name }}</span>
                @if (symbol.container.length > 0) {
                  <span class="go-to-dialog__container">{{ symbol.container }}</span>
                }
              </ng-template>
            </app-list-view>
          }
          <app-button-row class="go-to-dialog__actions">
            <app-button
              variant="solid"
              label="Go"
              [disabled]="picker.selectedId() === null"
              (click)="commit()"
            />
            <app-button label="Cancel" (click)="dismissed.emit()" />
          </app-button-row>
        </div>
      </ng-template>
    </app-modal>
  `,
})
export class GoToSymbolModal {
  /**
   * Gets a value indicating whether the dialog is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets the document's symbols, or null while they are being read.
   */
  public readonly symbols: InputSignal<readonly GoToSymbol[] | null> = input<
    readonly GoToSymbol[] | null
  >(null);

  /**
   * Emitted with where to go when a symbol is chosen.
   */
  public readonly picked: OutputEmitterRef<GoToTarget> = output<GoToTarget>();

  /**
   * Emitted when the dialog is dismissed without going anywhere.
   */
  public readonly dismissed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the state behind the dialog: what was typed, the symbols it matches, and the one selected.
   */
  protected readonly picker: GoToPicker = new GoToPicker(
    (): readonly GoToSymbol[] | null => this.symbols(),
    (): number => 1,
  );

  /**
   * Moves the selection through the symbols, keeping the caret where it is in the field.
   * @param event The arrow key's event.
   * @param step How far to move: 1 down, -1 up.
   */
  protected step(event: Event, step: number): void {
    event.preventDefault();
    this.picker.step(step);
  }

  /**
   * Goes to the selected symbol, when there is one.
   * @param event The Enter key's event, cancelled so it cannot reach the editor once it has focus;
   * undefined for the button.
   */
  protected commit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const target: GoToTarget | null = this.picker.symbolTarget();
    if (target !== null) {
      this.picked.emit(target);
    }
  }

  /**
   * Goes to a clicked symbol.
   * @param row The clicked row, carrying its symbol.
   */
  protected pick(row: ListRow): void {
    this.picked.emit((row.data as GoToSymbol).target);
  }

  /**
   * Reads a row's symbol, for the row template.
   * @param row The row.
   * @returns Returns the symbol it carries.
   */
  protected symbolOf(row: ListRow): GoToSymbol {
    return row.data as GoToSymbol;
  }
}
