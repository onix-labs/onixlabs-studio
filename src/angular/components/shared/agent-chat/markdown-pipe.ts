import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';

/**
 * Renders markdown text to an HTML string for binding through `[innerHTML]` (which Angular sanitises,
 * stripping scripts and event handlers from model output). Pure, so it recomputes only when its input
 * changes — suitable for the many small, streaming assistant bubbles.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  /**
   * Renders markdown to sanitised-on-bind HTML.
   * @param value The markdown text.
   * @returns Returns the HTML string (empty for blank input).
   */
  public transform(value: string | null | undefined): string {
    if (value === null || value === undefined || value.length === 0) {
      return '';
    }
    return marked.parse(value, { async: false });
  }
}
