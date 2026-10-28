import { CdkMenuTrigger } from '@angular/cdk/menu';
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
import { Icon } from '@shared/angular/icons/icon';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  EXPLORER_FILTER_KINDS,
  ExplorerFilterKind,
} from '@shared/angular/services/explorer-filter/explorer-filter';

/**
 * Describes an explorer's filter as its tool strip shows it (#1182 follow-up): the kinds ticked, and
 * why any kind cannot be ticked here — Show Differences outside a repository, say.
 */
export interface ExplorerFilterState {
  /**
   * Gets the kinds ticked.
   */
  readonly selected: ReadonlySet<ExplorerFilterKind>;

  /**
   * Gets why each kind that cannot be ticked cannot be, by kind.
   */
  readonly unavailable: Readonly<Partial<Record<ExplorerFilterKind, string>>>;
}

/**
 * The shared explorer tool strip rendered at the top of the Solution Explorer, File Explorer and API
 * Explorer panel bodies (those panels opt out of the dock's default strip). It pairs a search box on
 * the left with expand-all, collapse-all, and — when the panel has commands for it — a more-actions
 * menu on the right. A panel may project
 * buttons of its own, which sit between collapse-all and the menu (the Repository panel's Refresh). The toolbar is purely
 * presentational: it emits the search text, the expand/collapse intents, and the chosen menu item,
 * leaving the panel to drive its own model.
 */
@Component({
  selector: 'app-explorer-toolbar',
  imports: [TextField, Button, CdkMenuTrigger, Menu],
  templateUrl: './explorer-toolbar.html',
  styleUrl: './explorer-toolbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerToolbar {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the current search query shown in the search box.
   */
  public readonly query: InputSignal<string> = input<string>('');

  /**
   * Gets the placeholder shown in the empty search box.
   */
  public readonly searchPlaceholder: InputSignal<string> = input<string>('Search');

  /**
   * Emits the search query as the user types.
   */
  public readonly queryChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits when the expand-all button is pressed.
   */
  public readonly expandAll: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when the collapse-all button is pressed.
   */
  public readonly collapseAll: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the explorer's filter, shown as a funnel whose menu ticks what the tree is narrowed to — or
   * null for an explorer that cannot be narrowed.
   */
  public readonly filter: InputSignal<ExplorerFilterState | null> =
    input<ExplorerFilterState | null>(null);

  /**
   * Emits the kind ticked or unticked in the filter's menu.
   */
  public readonly filterToggle: OutputEmitterRef<ExplorerFilterKind> = output<ExplorerFilterKind>();

  /**
   * Gets the filter menu's rows: each kind, ticked or not, and inert where it cannot be ticked.
   */
  protected readonly filterItems: Signal<readonly MenuItem[]> = computed(
    (): readonly MenuItem[] => {
      const filter: ExplorerFilterState | null = this.filter();
      if (filter === null) {
        return [];
      }
      return EXPLORER_FILTER_KINDS.map(
        ({
          kind,
          label,
        }: {
          readonly kind: ExplorerFilterKind;
          readonly label: string;
        }): MenuItem => {
          const unavailable: string | undefined = filter.unavailable[kind];
          return {
            id: kind,
            label: unavailable === undefined ? label : `${label} (${unavailable})`,
            checked: filter.selected.has(kind),
            ...(unavailable === undefined ? {} : { disabled: true }),
          };
        },
      );
    },
  );

  /**
   * Hands on a filter menu choice.
   * @param id The row's identifier: the kind.
   */
  protected onFilter(id: string): void {
    this.filterToggle.emit(id as ExplorerFilterKind);
  }

  /**
   * Gets the items offered by the more-actions menu — the panel's own commands, since only the panel
   * knows what can be added to what it shows. With none, the strip shows no menu button rather than
   * one with nothing behind it (#882).
   */
  public readonly moreItems: InputSignal<readonly MenuItem[]> = input<readonly MenuItem[]>([]);

  /**
   * Emits the id of the chosen more-actions item.
   */
  public readonly moreSelected: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the latest search query from the search box.
   * @param event The input event raised by the search box.
   */
  protected onSearchValue(value: string): void {
    this.queryChange.emit(value);
  }
}
