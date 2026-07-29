import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Review, ReviewFilter } from '@features/markdown/angular/markdown-review/markdown-review';
import {
  ReviewCounts,
  ReviewIssue,
  ReviewKind,
} from '@features/markdown/angular/markdown-review/review-types';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
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
 * The Review tool panel: spelling, grammar, and style findings for the active document, with filter
 * chips, per-issue suggestions, add-to-dictionary, and ignore. Clicking an issue reveals it in the
 * editor.
 */
@Component({
  selector: 'app-markdown-review-panel',
  imports: [Button, ToolPanel],
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
   * Gets the issues to display.
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
   * Gets the count for a filter value.
   * @param value The filter value.
   * @returns Returns the count.
   */
  protected countFor(value: ReviewFilter): number {
    const counts: ReviewCounts = this.counts();
    return value === 'all' ? counts.all : counts[value];
  }

  /**
   * Gets the capitalised label for an issue kind.
   * @param kind The issue kind.
   * @returns Returns the label.
   */
  protected kindLabel(kind: ReviewKind): string {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
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
   * Applies a suggestion.
   * @param issue The issue.
   * @param suggestion The chosen suggestion.
   */
  protected onApply(issue: ReviewIssue, suggestion: string): void {
    this.review.applySuggestion(issue, suggestion);
  }

  /**
   * Adds the issue's word to the personal dictionary.
   * @param issue The issue.
   */
  protected onDictionary(issue: ReviewIssue): void {
    this.review.addToDictionary(issue);
  }

  /**
   * Ignores an issue.
   * @param issue The issue.
   */
  protected onIgnore(issue: ReviewIssue): void {
    this.review.ignore(issue);
  }
}
