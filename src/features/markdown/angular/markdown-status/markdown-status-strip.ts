import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import {
  computeMarkdownStats,
  MarkdownContext,
  MarkdownStats,
  MarkdownStatus,
} from './markdown-status';

/**
 * Formats a count with the reader's digit grouping.
 */
const COUNT: Intl.NumberFormat = new Intl.NumberFormat();

/**
 * The markdown view's status-strip segments (#882): the document's path on the left, as the Code
 * Editor's, and on the right its word count — "12 of 340 words" while text is selected — its character
 * count and its read time. Mounted by the status strip through the active markdown view's injector,
 * so it reads that view's own {@link MarkdownStatus}.
 */
@Component({
  selector: 'app-markdown-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownStatusStrip {
  /**
   * Holds the owning view's document.
   */
  private readonly status: MarkdownStatus = inject(MarkdownStatus);

  /**
   * Gets the start-aligned segments: the document's path.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: MarkdownContext | null = this.status.context();
      return context === null
        ? []
        : [{ id: 'markdown-path', text: context.path ?? 'New Document', shrink: 'start' }];
    },
  );

  /**
   * Gets the end-aligned segments: the word count (of the selection too, while there is one), the
   * character count, and the read time for a non-empty document.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: MarkdownContext | null = this.status.context();
      if (context === null) {
        return [];
      }
      const stats: MarkdownStats = computeMarkdownStats(context.text);
      const total: string = stats.words === 1 ? '1 word' : `${COUNT.format(stats.words)} words`;
      const selected: number | null =
        context.selectedText === null ? null : computeMarkdownStats(context.selectedText).words;
      const segments: StatusSegment[] = [
        {
          id: 'markdown-words',
          text: selected === null ? total : `${COUNT.format(selected)} of ${total}`,
        },
        {
          id: 'markdown-characters',
          text:
            stats.characters === 1 ? '1 character' : `${COUNT.format(stats.characters)} characters`,
        },
      ];
      if (stats.words > 0) {
        segments.push({ id: 'markdown-read', text: `${stats.readMinutes} min read` });
      }
      return segments;
    },
  );
}
