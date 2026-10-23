import { CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';

/**
 * The state of an explorer's Show Changed Files Only toggle.
 */
export interface ExplorerChangesOnly {
  /**
   * Gets a value indicating whether the tree shows only changed files.
   */
  readonly on: boolean;

  /**
   * Gets why the toggle cannot be pressed — `not a repository`, `no changes` — or null when it can.
   */
  readonly unavailable: string | null;
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
   * Gets the state of the Show Changed Files Only toggle, which sits between the search box and
   * expand-all — or null, for an explorer that has no changes to narrow to and so shows no toggle.
   */
  public readonly changesOnly: InputSignal<ExplorerChangesOnly | null> =
    input<ExplorerChangesOnly | null>(null);

  /**
   * Emits when the Show Changed Files Only toggle is pressed.
   */
  public readonly changesOnlyToggle: OutputEmitterRef<void> = output<void>();

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
