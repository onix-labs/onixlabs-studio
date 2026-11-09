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
import { NumberField } from '@shared/angular/components/forms/number-field/number-field';
import { FormModal } from './form-modal';

/**
 * Holds the size a new table starts at, a header row and two body rows of three columns.
 */
const DEFAULT_ROWS: number = 3;

/**
 * Holds the columns a new table starts with.
 */
const DEFAULT_COLUMNS: number = 3;

/**
 * Holds the most rows or columns the modal offers.
 */
const MAXIMUM_SIZE: number = 50;

/**
 * Describes a table to insert.
 */
export interface TableInsert {
  /**
   * Gets the number of rows, counting the header.
   */
  readonly rows: number;

  /**
   * Gets the number of columns.
   */
  readonly columns: number;
}

/**
 * Prompts for a table's rows and columns, then emits the size to insert. Hosted by the markdown
 * ribbon's Insert group.
 */
@Component({
  selector: 'app-markdown-table-modal',
  imports: [FormModal, NumberField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-form-modal
      [open]="open()"
      heading="Insert Table"
      [width]="30"
      [canSubmit]="valid()"
      (confirmed)="confirm()"
      (cancelled)="cancel()"
    >
      <div class="insert-modal__pair">
        <app-number-field
          variant="floating"
          label="Rows"
          [fullWidth]="true"
          [spinner]="false"
          [digitsOnly]="true"
          [live]="true"
          [min]="1"
          [max]="maximum"
          [(value)]="rows"
        />
        <app-number-field
          variant="floating"
          label="Columns"
          [fullWidth]="true"
          [spinner]="false"
          [digitsOnly]="true"
          [live]="true"
          [min]="1"
          [max]="maximum"
          [(value)]="columns"
        />
      </div>
    </app-form-modal>
  `,
})
export class MarkdownTableModal {
  /**
   * Holds the structured logging client for the insert modal's confirmation.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the most rows or columns offered, for the template.
   */
  protected readonly maximum: number = MAXIMUM_SIZE;

  /**
   * Gets a value indicating whether the modal is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Emitted when the modal is dismissed without inserting.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted with the table to insert when the user confirms.
   */
  public readonly submitted: OutputEmitterRef<TableInsert> = output<TableInsert>();

  /**
   * Holds the rows field value.
   */
  protected readonly rows: WritableSignal<number> = signal<number>(DEFAULT_ROWS);

  /**
   * Holds the columns field value.
   */
  protected readonly columns: WritableSignal<number> = signal<number>(DEFAULT_COLUMNS);

  /**
   * Gets a value indicating whether the form can be submitted (both sizes are in range).
   */
  protected readonly valid: Signal<boolean> = computed(
    (): boolean => this.inRange(this.rows()) && this.inRange(this.columns()),
  );

  /**
   * Confirms the dialog, emitting the table's size.
   */
  protected confirm(): void {
    if (!this.valid()) {
      return;
    }
    this.log.debug('markdown.insert', 'Table modal confirmed');
    this.submitted.emit({ rows: this.rows(), columns: this.columns() });
    this.closed.emit();
  }

  /**
   * Cancels the dialog.
   */
  protected cancel(): void {
    this.closed.emit();
  }

  /**
   * Determines whether a size can be inserted.
   * @param size The size.
   * @returns Returns true for a whole number from one up to the maximum.
   */
  private inRange(size: number): boolean {
    return Number.isInteger(size) && size >= 1 && size <= MAXIMUM_SIZE;
  }
}
