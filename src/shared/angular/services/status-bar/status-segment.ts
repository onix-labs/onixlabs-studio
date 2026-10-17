import { Icon } from '@shared/angular/icons/icon';

/**
 * Defines a single segment of contextual information shown in the status strip.
 */
export interface StatusSegment {
  /**
   * Gets the unique identifier of the segment.
   */
  readonly id: string;

  /**
   * Gets the text of the segment.
   */
  readonly text: string;

  /**
   * Gets the optional icon of the segment.
   */
  readonly icon?: Icon;

  /**
   * Gets the optional hover title of the segment, spelling out what a terse icon-and-count segment
   * (for example a commits-to-push arrow) means.
   */
  readonly title?: string;

  /**
   * Gets which end of the text gives way when the strip is short of room, if this segment may shorten
   * at all (#882). A path shortens from its start, keeping the file name; a name or branch from its
   * end. A segment that may not shorten keeps its width and, when even shortening is not enough, drops
   * out of the strip whole rather than being cut through.
   */
  readonly shrink?: 'start' | 'end';
}
