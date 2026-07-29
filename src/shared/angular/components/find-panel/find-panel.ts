import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
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
import { PanelDragHandle } from '@shared/angular/components/panel-layout/panel-drag-handle';
import { Button } from '@shared/angular/components/forms/button/button';
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { Icon } from '@shared/angular/icons/icon';
import { FindAdapter, FindQuery, FindResultItem } from './find-adapter';

/**
 * Identifies which view the find panel shows.
 */
type FindMode = 'find' | 'replace';

/**
 * Represents the shared find-and-replace panel used across every editing surface. The panel owns the
 * query text, replacement text, search options, and which view is shown, and drives whichever
 * {@link FindAdapter} its host supplies — a Monaco editor, a markdown document, or the workspace — so
 * it contains no engine-specific code. It renders the adapter's match list, keeps the active row in
 * step with the editor, and disables each control (previous/next at the ends, replace/undo when there
 * is nothing to act on) from the adapter's state.
 */
@Component({
  selector: 'app-find-panel',
  imports: [ButtonGroup, Button, TextField, Checkbox, AppIcon, PanelDragHandle],
  templateUrl: './find-panel.html',
  styleUrl: './find-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindPanel implements OnDestroy {
  /**
   * Gets the two find modes, offered as one segmented control.
   */
  protected readonly modeOptions: readonly ButtonGroupOption[] = [
    { value: 'find', label: 'Find Only' },
    { value: 'replace', label: 'Find and Replace' },
  ];

  /**
   * Gets the adapter the panel drives, or null before the host binds one.
   */
  public readonly adapter: InputSignal<FindAdapter | null> = input<FindAdapter | null>(null);

  /**
   * Gets a value indicating whether the panel shows its own title-and-close header. Hosts that supply
   * their own chrome (for example a dock panel with a tab and close control) set this false to avoid
   * doubling it.
   */
  public readonly showHeader: InputSignal<boolean> = input<boolean>(true);

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
   * Holds the requested view; forced to find when the surface does not support replace.
   */
  private readonly requestedMode: WritableSignal<FindMode> = signal<FindMode>('find');

  /**
   * Gets the close-button icon.
   */
  protected readonly closeIcon: Icon = Icon.CLOSE;

  /**
   * Gets the previous-match icon.
   */
  protected readonly previousIcon: Icon = Icon.CARET_LEFT;

  /**
   * Gets the next-match icon.
   */
  protected readonly nextIcon: Icon = Icon.CARET_RIGHT;

  /**
   * Holds the find input's host element, used to focus it when the panel opens.
   */
  private readonly findField: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('findField');

  /**
   * Holds this panel's host element, used to scroll the active result row into view.
   */
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef) as ElementRef<HTMLElement>;

  /**
   * Gets whether the bound surface supports replace, so the panel can offer the replace view.
   */
  protected readonly supportsReplace: Signal<boolean> = computed(
    (): boolean => this.adapter()?.supportsReplace ?? false,
  );

  /**
   * Gets the panel's header title, reflecting whether the bound surface offers replace.
   */
  protected readonly title: Signal<string> = computed((): string =>
    this.supportsReplace() ? 'Find and Replace' : 'Find',
  );

  /**
   * Gets the effective view: the requested one, forced to find when replace is unsupported.
   */
  protected readonly mode: Signal<FindMode> = computed(
    (): FindMode => (this.supportsReplace() ? this.requestedMode() : 'find'),
  );

  /**
   * Gets the current matches.
   */
  protected readonly matches: Signal<readonly FindResultItem[]> = computed(
    (): readonly FindResultItem[] => this.adapter()?.matches() ?? [],
  );

  /**
   * Gets the zero-based index of the active match, or -1 when none.
   */
  protected readonly activeIndex: Signal<number> = computed(
    (): number => this.adapter()?.activeIndex() ?? -1,
  );

  /**
   * Gets the number of matches.
   */
  protected readonly matchCount: Signal<number> = computed((): number => this.matches().length);

  /**
   * Gets a value indicating whether the active query currently has any match.
   */
  protected readonly hasMatches: Signal<boolean> = computed((): boolean => this.matchCount() > 0);

  /**
   * Gets whether there is a previous match to move to (navigation does not wrap).
   */
  protected readonly canPrevious: Signal<boolean> = computed((): boolean => this.activeIndex() > 0);

  /**
   * Gets whether there is a next match to move to (navigation does not wrap). A fresh result set with
   * nothing selected can still advance to the first match.
   */
  protected readonly canNext: Signal<boolean> = computed(
    (): boolean => this.matchCount() > 0 && this.activeIndex() < this.matchCount() - 1,
  );

  /**
   * Gets the active match, or null when none is selected.
   */
  protected readonly activeItem: Signal<FindResultItem | null> = computed(
    (): FindResultItem | null => this.matches()[this.activeIndex()] ?? null,
  );

  /**
   * Gets whether the active match can be replaced (one is selected).
   */
  protected readonly canReplace: Signal<boolean> = computed(
    (): boolean => this.supportsReplace() && this.activeItem() !== null,
  );

  /**
   * Gets whether any match remains to be replaced.
   */
  protected readonly canReplaceAll: Signal<boolean> = computed(
    (): boolean => this.supportsReplace() && this.matchCount() > 0,
  );

  /**
   * Gets whether the last replace can be undone.
   */
  protected readonly canUndo: Signal<boolean> = computed(
    (): boolean => this.adapter()?.canUndo() ?? false,
  );

  /**
   * Gets the match summary shown beside the find field ("3 of 12", "12 found", "No results", or empty
   * when the query is empty).
   */
  protected readonly matchLabel: Signal<string> = computed((): string => {
    if (this.adapter() === null || this.findText().length === 0) {
      return '';
    }
    const count: number = this.matchCount();
    if (count === 0) {
      return 'No results';
    }
    const active: number = this.activeIndex();
    return active >= 0 ? `${active + 1} of ${count}` : `${count} found`;
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

    // Keep the active row visible as the selection moves through the list; runs after render so the
    // active row already carries its class.
    afterRenderEffect((): void => {
      if (this.activeIndex() < 0) {
        return;
      }
      this.host.nativeElement
        .querySelector('.find-panel__result.is-active')
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  /**
   * Switches the panel to the given view.
   * @param mode The view to show.
   */
  protected setMode(mode: FindMode): void {
    this.requestedMode.set(mode);
  }

  /**
   * Selects the match at the given index.
   * @param index The zero-based index of the match to select.
   */
  protected select(index: number): void {
    this.adapter()?.select(index);
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
   * Undoes the most recent replace.
   */
  protected undo(): void {
    this.adapter()?.undo();
  }

  /**
   * Builds a display label for a match row, prefixing the file for a multi-file surface.
   * @param item The match.
   * @returns Returns the position label.
   */
  protected positionLabel(item: FindResultItem): string {
    const position: string = `Ln ${item.line} Col ${item.column}`;
    return item.file === undefined ? position : `${item.file} · ${position}`;
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
