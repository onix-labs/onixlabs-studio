import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Defines one tab of a {@link TabList}.
 */
export interface TabListTab {
  /**
   * Gets the value the tab selects.
   */
  readonly value: string;

  /**
   * Gets the tab's label.
   */
  readonly label: string;

  /**
   * Gets the optional icon shown before the label.
   */
  readonly icon?: Icon;

  /**
   * Gets an optional count shown after the label, as a result's set count is.
   */
  readonly badge?: number;

  /**
   * Gets the badge's tone: `error` when the count is of something that went wrong.
   */
  readonly badgeTone?: 'error';
}

/**
 * Represents a row of section tabs (#1121): labels over a shared rule, the selected one underlined —
 * the tabs a dialog or a panel switches its content with. It is controlled: it shows whatever
 * {@link value} supplies and reports picks through {@link valueChange}. The arrow keys, Home and End
 * move between tabs, as a tab list's do. Content projected into it — view switches, a spacer's worth
 * of controls — sits after the tabs, at the row's trailing edge.
 */
@Component({
  selector: 'app-tab-list',
  imports: [AppIcon],
  templateUrl: './tab-list.html',
  styleUrl: './tab-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabList {
  /**
   * Gets the tabs.
   */
  public readonly tabs: InputSignal<readonly TabListTab[]> =
    input.required<readonly TabListTab[]>();

  /**
   * Gets the selected tab's value.
   */
  public readonly value: InputSignal<string> = input<string>('');

  /**
   * Gets the accessible name of the tab list.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Emits the value of the tab picked.
   */
  public readonly valueChange: OutputEmitterRef<string> = output<string>();

  /**
   * Holds the host element, to move focus with the selection.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Reports a picked tab.
   * @param value The tab's value.
   */
  protected select(value: string): void {
    if (value !== this.value()) {
      this.valueChange.emit(value);
    }
  }

  /**
   * Moves between tabs with the arrow keys, Home and End, selecting and focusing the one moved to.
   * @param event The key event.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const tabs: readonly TabListTab[] = this.tabs();
    const current: number = Math.max(
      0,
      tabs.findIndex((tab: TabListTab): boolean => tab.value === this.value()),
    );
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: (current + 1) % tabs.length,
      ArrowLeft: (current - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next: number | undefined = moves[event.key];
    if (next === undefined || tabs.length === 0) {
      return;
    }
    event.preventDefault();
    this.select(tabs[next].value);
    this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
}
