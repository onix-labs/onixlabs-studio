import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { TableTreeState } from '../table';

/**
 * The first cell's content of a tree table's row: the row indented to its depth, a twisty that folds
 * and unfolds the rows beneath it, and the consumer's label. It goes inside the row template's first
 * `<td>`, given the template's `tree` context:
 *
 * ```html
 * <ng-template appTableRow let-row let-tree="tree">
 *   <td><app-table-tree-cell [tree]="tree">{{ row.data.name }}</app-table-tree-cell></td>
 * </ng-template>
 * ```
 *
 * A row with nothing beneath it keeps the twisty's room, so labels at one depth line up.
 */
@Component({
  selector: 'app-table-tree-cell',
  imports: [AppIcon],
  templateUrl: './table-tree-cell.html',
  styleUrl: './table-tree-cell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableTreeCell {
  /**
   * Gets where the row sits in the tree; undefined draws the label at the top level with no twisty.
   */
  public readonly tree: InputSignal<TableTreeState | undefined> = input<
    TableTreeState | undefined
  >();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the row's depth, which the stylesheet indents by.
   */
  protected readonly depth: Signal<number> = computed((): number => this.tree()?.depth ?? 0);

  /**
   * Gets the twisty's accessible name and tooltip: what pressing it does.
   */
  protected readonly twistyLabel: Signal<string> = computed((): string =>
    this.tree()?.expanded === true
      ? $localize`:A tree table row's button that hides the rows beneath it:Collapse`
      : $localize`:A tree table row's button that shows the rows beneath it:Expand`,
  );

  /**
   * Folds or unfolds the row, without the click also selecting it.
   * @param event The click.
   */
  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.tree()?.toggle();
  }
}
