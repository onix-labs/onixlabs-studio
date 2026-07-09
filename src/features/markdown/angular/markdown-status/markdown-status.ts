import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { StatusBar, StatusSegment } from '@shared/angular/services/status-bar/status-bar';

/**
 * Holds the status-bar owner identifier for the markdown editor's contribution.
 */
const STATUS_OWNER: string = 'markdown';

/**
 * Holds the status-bar priority for the markdown editor, matching the code editor's so a document's
 * stats sit ahead of the terminal's trailing working-directory segment.
 */
const STATUS_PRIORITY: number = 10;

/**
 * Holds the average reading speed, in words per minute, used to estimate a document's read time.
 */
const WORDS_PER_MINUTE: number = 200;

/**
 * Describes a markdown document's derived statistics.
 */
export interface MarkdownStats {
  /**
   * Gets the number of whitespace-separated words in the document.
   */
  readonly words: number;

  /**
   * Gets the estimated read time in minutes (at least one minute for any non-empty document, zero
   * when empty).
   */
  readonly readMinutes: number;
}

/**
 * Computes a markdown document's word count and estimated read time from its raw content.
 * @param content The document's markdown text.
 * @returns Returns the derived statistics.
 */
export function computeMarkdownStats(content: string): MarkdownStats {
  const trimmed: string = content.trim();
  const words: number = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const readMinutes: number = words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { words, readMinutes };
}

/**
 * Publishes the active markdown editor's document statistics to the status strip.
 *
 * The active editor pushes its content here; an effect derives the word count and read time and
 * projects them as trailing segments, clearing the contribution when no markdown editor is active (the
 * content is null). The document name is left to the strip's active-tab fallback, so only the stats are
 * contributed here.
 */
@Service()
export class MarkdownStatus {
  /**
   * Holds the status bar the statistics are published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active editor's content and the tab that published it, or null when no markdown editor
   * is active. The tab is tracked so a deactivating editor only clears the strip when it still owns it —
   * never wiping out the editor that just became active.
   */
  private readonly contentSignal: WritableSignal<{ tabId: string; content: string } | null> =
    signal<{ tabId: string; content: string } | null>(null);

  /**
   * Initializes the service, projecting the document statistics as trailing status segments.
   */
  public constructor() {
    effect((): void => {
      const current: { tabId: string; content: string } | null = this.contentSignal();
      if (current === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      const stats: MarkdownStats = computeMarkdownStats(current.content);
      const trailing: StatusSegment[] = [
        { id: 'markdown-words', text: stats.words === 1 ? '1 word' : `${stats.words} words` },
      ];
      if (stats.words > 0) {
        trailing.push({ id: 'markdown-read', text: `${stats.readMinutes} min read` });
      }
      this.statusBar.contribute(STATUS_OWNER, { leading: [], trailing }, STATUS_PRIORITY);
    });
  }

  /**
   * Publishes the given tab's editor content as the active document statistics.
   * @param tabId The identifier of the publishing tab.
   * @param content The editor's markdown content.
   */
  public publish(tabId: string, content: string): void {
    this.contentSignal.set({ tabId, content });
  }

  /**
   * Clears the statistics, but only when the given tab is the one currently shown, so a deactivating
   * editor never wipes out the editor that just became active.
   * @param tabId The identifier of the deactivating tab.
   */
  public clear(tabId: string): void {
    if (this.contentSignal()?.tabId === tabId) {
      this.contentSignal.set(null);
    }
  }
}
