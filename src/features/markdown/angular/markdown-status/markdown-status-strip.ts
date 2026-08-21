import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { computeMarkdownStats, MarkdownStats, MarkdownStatus } from './markdown-status';

/**
 * Shows the active markdown view's document statistics — its word count and estimated read time — at
 * the end of the status strip. The document's name is left to the strip's active-tab fallback, so
 * only the stats are shown here.
 *
 * Mounted by the status strip through the active markdown view's injector, so it reads that view's
 * own {@link MarkdownStatus}; it is destroyed when another tab is activated.
 */
@Component({
  selector: 'app-markdown-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownStatusStrip {
  /**
   * Holds the owning view's editor content.
   */
  private readonly status: MarkdownStatus = inject(MarkdownStatus);

  /**
   * Gets the end-aligned segments: the word count, and the read time for a non-empty document.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const content: string | null = this.status.content();
      if (content === null) {
        return [];
      }
      const stats: MarkdownStats = computeMarkdownStats(content);
      const segments: StatusSegment[] = [
        { id: 'markdown-words', text: stats.words === 1 ? '1 word' : `${stats.words} words` },
      ];
      if (stats.words > 0) {
        segments.push({ id: 'markdown-read', text: `${stats.readMinutes} min read` });
      }
      return segments;
    },
  );
}
