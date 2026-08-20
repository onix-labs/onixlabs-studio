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
import { Button } from '@shared/angular/components/forms/button/button';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';

/**
 * One editable name/value pair shown by a {@link PropertyGrid}.
 */
export interface PropertyGridRow {
  /**
   * Gets the row's stable identity, used as the render key and quoted back in every edit.
   */
  readonly id: string;

  /**
   * Gets the property name.
   */
  readonly name: string;

  /**
   * Gets the property value.
   */
  readonly value: string;

  /**
   * Gets whether the row is ticked. Only meaningful when the grid shows its tick column; rows without
   * the flag read as enabled.
   */
  readonly enabled?: boolean;
}

/**
 * An edit to one row: the row's identity and the properties that changed.
 */
export interface PropertyGridEdit {
  /**
   * Gets the identity of the edited row.
   */
  readonly id: string;

  /**
   * Gets the name, when it changed.
   */
  readonly name?: string;

  /**
   * Gets the value, when it changed.
   */
  readonly value?: string;

  /**
   * Gets the ticked state, when it changed.
   */
  readonly enabled?: boolean;
}

/**
 * Mints an identity for the blank row the grid offers.
 * @returns Returns a new unique identifier.
 */
function newRowId(): string {
  return crypto.randomUUID();
}

/**
 * The shared editor for name/value pairs: query parameters, headers, form fields, environment
 * variables — anywhere a feature would otherwise hand-roll a column of paired text boxes.
 *
 * It reads as a grid rather than a stack of inputs: a header row names the columns, every row carries
 * an optional tick (rows that are present but not sent) and a remove button, and a blank row waits at
 * the end so there is always somewhere to type. That blank row is the grid's own, and it is what makes
 * adding a property feel like typing into a spreadsheet rather than pressing "Add" first: the row's
 * identity is minted *before* the user types, handed out with {@link add}, and adopted by the consumer
 * for the row it stores — so the element the user is typing into is the element that becomes the real
 * row, and the caret stays where it was.
 *
 * The grid holds no data of its own beyond that pending identity. Rows in, edits out; the consumer
 * owns the list and decides what an edit means (dropping a row blanked out entirely, refusing a
 * duplicate name, and so on).
 */
@Component({
  selector: 'app-property-grid',
  imports: [Button, Checkbox, TextField],
  templateUrl: './property-grid.html',
  styleUrl: './property-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertyGrid {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the rows to edit, in display order.
   */
  public readonly rows: InputSignal<readonly PropertyGridRow[]> =
    input.required<readonly PropertyGridRow[]>();

  /**
   * Gets the header of the name column.
   */
  public readonly nameHeader: InputSignal<string> = input<string>('Name');

  /**
   * Gets the header of the value column.
   */
  public readonly valueHeader: InputSignal<string> = input<string>('Value');

  /**
   * Gets the placeholder shown in an empty name cell.
   */
  public readonly namePlaceholder: InputSignal<string> = input<string>('Key');

  /**
   * Gets the placeholder shown in an empty value cell.
   */
  public readonly valuePlaceholder: InputSignal<string> = input<string>('Value');

  /**
   * Gets whether each row carries a tick that includes or excludes it, as query parameters and headers
   * do. Grids whose rows are always live (a plain settings list) turn the column off.
   */
  public readonly checkable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the label describing the grid to assistive technology.
   */
  public readonly ariaLabel: InputSignal<string> = input<string>('Properties');

  /**
   * Emits when an existing row is edited.
   */
  public readonly rowChange: OutputEmitterRef<PropertyGridEdit> = output<PropertyGridEdit>();

  /**
   * Emits when the blank row is typed into, carrying the identity the new row must be stored under.
   */
  public readonly add: OutputEmitterRef<PropertyGridRow> = output<PropertyGridRow>();

  /**
   * Emits the identity of a row whose remove button was pressed.
   */
  public readonly remove: OutputEmitterRef<string> = output<string>();

  /**
   * Holds the identity the blank row will be stored under once it is typed into. Re-minted after each
   * hand-off, so the next blank row is a fresh one.
   */
  private readonly draftId: WritableSignal<string> = signal<string>(newRowId());

  /**
   * Gets the rows to render: the consumer's, followed by the blank one waiting to be typed into.
   */
  protected readonly displayRows: Signal<readonly PropertyGridRow[]> = computed(
    (): readonly PropertyGridRow[] => [
      ...this.rows(),
      { id: this.draftId(), name: '', value: '', enabled: true },
    ],
  );

  /**
   * Determines whether a rendered row is the blank one.
   * @param row The row to test.
   * @returns Returns true when the row is the blank row.
   */
  protected isDraft(row: PropertyGridRow): boolean {
    return row.id === this.draftId();
  }

  /**
   * Writes an edit: an existing row reports a change, while the blank row is promoted into a new one.
   * @param row The row being edited.
   * @param change The property that changed.
   */
  protected write(row: PropertyGridRow, change: Omit<PropertyGridEdit, 'id'>): void {
    if (this.isDraft(row)) {
      this.promote(change);
      return;
    }
    this.edit(row.id, change);
  }

  /**
   * Reports an edit to an existing row.
   * @param id The identity of the edited row.
   * @param change The property that changed.
   */
  protected edit(id: string, change: Omit<PropertyGridEdit, 'id'>): void {
    this.rowChange.emit({ id, ...change });
  }

  /**
   * Promotes the blank row into a real one, handing the consumer the identity the row is already being
   * rendered under, and re-mints the identity the *next* blank row will use.
   * @param change The property the user typed into.
   */
  private promote(change: Omit<PropertyGridEdit, 'id'>): void {
    this.add.emit({
      id: this.draftId(),
      name: change.name ?? '',
      value: change.value ?? '',
      enabled: true,
    });
    this.draftId.set(newRowId());
  }
}
