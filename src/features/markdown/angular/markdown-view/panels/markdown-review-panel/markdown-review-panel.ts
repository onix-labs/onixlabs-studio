import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Review, ReviewFilter } from '@features/markdown/angular/markdown-review/markdown-review';
import { ReviewCounts, ReviewIssue } from '@features/markdown/angular/markdown-review/review-types';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * A filter chip descriptor.
 */
interface FilterChip {
  /**
   * Gets the filter value the chip selects.
   */
  readonly value: ReviewFilter;

  /**
   * Gets the chip label.
   */
  readonly label: string;
}

/**
 * The non-"all" filter chips, in display order.
 */
const KIND_CHIPS: readonly FilterChip[] = [
  { value: 'spelling', label: 'Spelling' },
  { value: 'grammar', label: 'Grammar' },
  { value: 'style', label: 'Style' },
];

/**
 * The Review tool panel: walks through the spelling, grammar, and style findings for the active
 * document one issue at a time, as a word processor's spelling and grammar check does. Each action
 * moves on to the next issue, which is revealed in the editor. Filter chips narrow the walk.
 */
@Component({
  selector: 'app-markdown-review-panel',
  imports: [Button, ListView, ToolPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './markdown-review-panel.html',
  styleUrl: './markdown-review-panel.scss',
})
export class MarkdownReviewPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the markdown panel registry the tool panel's close button dismisses this panel through.
   */
  protected readonly panels: MarkdownPanels = inject(MarkdownPanels);

  /**
   * Holds the review service supplying findings and actions.
   */
  private readonly review: Review = inject(Review);

  /**
   * Gets whether a markdown editor is active.
   */
  protected readonly hasSession: Signal<boolean> = this.review.hasSession;

  /**
   * Gets whether the dictionary has loaded.
   */
  protected readonly ready: Signal<boolean> = this.review.ready;

  /**
   * Gets the issues the walk moves through.
   */
  protected readonly issues: Signal<readonly ReviewIssue[]> = this.review.issues;

  /**
   * Gets the issue counts.
   */
  protected readonly counts: Signal<ReviewCounts> = this.review.counts;

  /**
   * Gets the active filter.
   */
  protected readonly filter: Signal<ReviewFilter> = this.review.filter;

  /**
   * Gets the non-"all" filter chips.
   */
  protected readonly kindChips: readonly FilterChip[] = KIND_CHIPS;

  /**
   * Gets the issue being looked at, or null once none are left.
   */
  protected readonly current: Signal<ReviewIssue | null> = this.review.current;

  /**
   * Gets the current issue's one-based position among the issues.
   */
  protected readonly position: Signal<number> = this.review.position;

  /**
   * Gets whether there is a review action to undo.
   */
  protected readonly canUndo: Signal<boolean> = this.review.canUndo;

  /**
   * Gets the current issue's suggestions as list rows, a repeated suggestion listed once.
   */
  protected readonly suggestionRows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] =>
    [...new Set<string>(this.current()?.suggestions ?? [])].map((suggestion: string): ListRow => ({
      id: suggestion,
      data: suggestion,
    })),
  );

  /**
   * Holds the chosen suggestion: the first for each new issue, and kept across a re-analysis that
   * still offers it.
   */
  protected readonly selectedSuggestion: WritableSignal<string | null> = linkedSignal<
    readonly ListRow[],
    string | null
  >({
    source: this.suggestionRows,
    computation: (rows: readonly ListRow[], previous): string | null => {
      const kept: ListRow | undefined = rows.find(
        (row: ListRow): boolean => row.id === previous?.value,
      );
      return kept?.id ?? rows[0]?.id ?? null;
    },
  });

  /**
   * Gets the count for a filter value.
   * @param value The filter value.
   * @returns Returns the count.
   */
  protected countFor(value: ReviewFilter): number {
    const counts: ReviewCounts = this.counts();
    return value === 'all' ? counts.all : counts[value];
  }

  /**
   * Gets whether the add-to-dictionary action applies to an issue (spelling issues only).
   * @param issue The issue.
   * @returns Returns true for spelling issues.
   */
  protected canAddToDictionary(issue: ReviewIssue): boolean {
    return issue.kind === 'spelling';
  }

  /**
   * Re-runs the analysis on the active document.
   */
  protected onRefresh(): void {
    void this.review.refresh();
  }

  /**
   * Sets the active filter.
   * @param value The filter value.
   */
  protected onFilter(value: ReviewFilter): void {
    this.review.setFilter(value);
  }

  /**
   * Reveals an issue in the editor.
   * @param issue The issue.
   */
  protected onReveal(issue: ReviewIssue): void {
    this.review.reveal(issue);
  }

  /**
   * Moves to the previous issue.
   */
  protected onPrevious(): void {
    this.review.previous();
  }

  /**
   * Moves to the next issue.
   */
  protected onNext(): void {
    this.review.next();
  }

  /**
   * Chooses a suggestion.
   * @param row The suggestion's row.
   */
  protected onSuggestion(row: ListRow): void {
    this.selectedSuggestion.set(row.id);
  }

  /**
   * Replaces the issue's text with the chosen suggestion.
   * @param issue The issue.
   */
  protected onChange(issue: ReviewIssue): void {
    const suggestion: string | null = this.selectedSuggestion();
    if (suggestion !== null) {
      this.review.applySuggestion(issue, suggestion);
    }
  }

  /**
   * Replaces every occurrence of the issue's text with the chosen suggestion.
   * @param issue The issue.
   */
  protected onChangeAll(issue: ReviewIssue): void {
    const suggestion: string | null = this.selectedSuggestion();
    if (suggestion !== null) {
      this.review.applySuggestionToAll(issue, suggestion);
    }
  }

  /**
   * Adds the issue's word to the personal dictionary.
   * @param issue The issue.
   */
  protected onDictionary(issue: ReviewIssue): void {
    this.review.addToDictionary(issue);
  }

  /**
   * Ignores this occurrence of an issue.
   * @param issue The issue.
   */
  protected onIgnoreOnce(issue: ReviewIssue): void {
    this.review.ignoreOnce(issue);
  }

  /**
   * Ignores every occurrence of an issue.
   * @param issue The issue.
   */
  protected onIgnoreAll(issue: ReviewIssue): void {
    this.review.ignoreAll(issue);
  }

  /**
   * Takes back the last review action.
   */
  protected onUndo(): void {
    this.review.undo();
  }
}
