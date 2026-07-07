import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  InputSignal,
  OnDestroy,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { FindAdapter, FindQuery } from './find-adapter';

/**
 * Represents the shared find-and-replace panel used across every editing surface. The panel owns the
 * query text, replacement text, and search options, and drives whichever {@link FindAdapter} its host
 * supplies — a Monaco editor, a markdown document, or the workspace — so it contains no engine-specific
 * code. The replace row is hidden until toggled.
 */
@Component({
  selector: 'app-find-panel',
  imports: [TextField, Checkbox, AppIcon],
  templateUrl: './find-panel.html',
  styleUrl: './find-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindPanel implements OnDestroy {
  /**
   * Gets the adapter the panel drives, or null before the host binds one.
   */
  public readonly adapter: InputSignal<FindAdapter | null> = input<FindAdapter | null>(null);

  /**
   * Emits when the user dismisses the panel, so the host can close it.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the current find text.
   */
  protected readonly findText: WritableSignal<string> = signal<string>('');

  /**
   * Holds the current replacement text.
   */
  protected readonly replaceText: WritableSignal<string> = signal<string>('');

  /**
   * Holds a value indicating whether the search is case-sensitive.
   */
  protected readonly caseSensitive: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether the search matches whole words only.
   */
  protected readonly wholeWord: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether the find text is a regular expression.
   */
  protected readonly regexp: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether the replace row is shown.
   */
  protected readonly replaceVisible: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the close-button icon.
   */
  protected readonly closeIcon: Icon = Icon.CLOSE;

  /**
   * Gets the previous-match icon.
   */
  protected readonly previousIcon: Icon = Icon.CARET_UP;

  /**
   * Gets the next-match icon.
   */
  protected readonly nextIcon: Icon = Icon.CARET_DOWN;

  /**
   * Gets the replace-row toggle icon, pointing down when the row is shown and right when it is hidden.
   */
  protected readonly toggleIcon: Signal<Icon> = computed(
    (): Icon => (this.replaceVisible() ? Icon.CARET_DOWN : Icon.CARET_RIGHT),
  );

  /**
   * Holds the find input's host element, used to focus it when the panel opens.
   */
  private readonly findField: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('findField');

  /**
   * Gets a value indicating whether the active query currently has any match.
   */
  protected readonly hasMatches: Signal<boolean> = computed(
    (): boolean => (this.adapter()?.matchCount() ?? 0) > 0,
  );

  /**
   * Gets the match summary shown beside the find field ("3 of 12", "No results", or empty when the
   * query is empty).
   */
  protected readonly matchLabel: Signal<string> = computed((): string => {
    const adapter: FindAdapter | null = this.adapter();
    if (adapter === null || this.findText().length === 0) {
      return '';
    }
    const count: number = adapter.matchCount();
    if (count === 0) {
      return 'No results';
    }
    const active: number = adapter.activeMatch();
    return active > 0 ? `${active} of ${count}` : `${count} found`;
  });

  /**
   * Initializes a new instance of the {@link FindPanel} class, wiring the effect that re-runs the
   * query as the text or options change and focusing the find field once rendered.
   */
  public constructor() {
    effect((): void => {
      const query: FindQuery = {
        text: this.findText(),
        caseSensitive: this.caseSensitive(),
        wholeWord: this.wholeWord(),
        regexp: this.regexp(),
      };
      this.adapter()?.setQuery(query);
    });

    afterNextRender((): void => {
      this.findField()?.nativeElement.querySelector('input')?.focus();
    });
  }

  /**
   * Moves to the next match.
   */
  protected next(): void {
    this.adapter()?.next();
  }

  /**
   * Moves to the previous match.
   */
  protected previous(): void {
    this.adapter()?.previous();
  }

  /**
   * Shows or hides the replace row.
   */
  protected toggleReplace(): void {
    this.replaceVisible.update((visible: boolean): boolean => !visible);
  }

  /**
   * Replaces the active match with the replacement text.
   */
  protected replaceOne(): void {
    this.adapter()?.replace(this.replaceText());
  }

  /**
   * Replaces every match with the replacement text.
   */
  protected replaceEvery(): void {
    this.adapter()?.replaceAll(this.replaceText());
  }

  /**
   * Clears the query highlights and asks the host to close the panel.
   */
  protected dismiss(): void {
    this.adapter()?.clear();
    this.closed.emit();
  }

  /**
   * Clears the query highlights when the panel is removed by any means (including a host that closes
   * it without the close button), so no stale matches remain highlighted.
   */
  public ngOnDestroy(): void {
    this.adapter()?.clear();
  }
}
