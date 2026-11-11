import type { MenuItem } from '@shared/angular/components/menu/menu';
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

  /**
   * Gets a menu the segment opens when clicked, or undefined for a segment that only shows its text.
   */
  readonly menu?: StatusSegmentMenu;

  /**
   * Gets what clicking the segment does, for a segment that acts at once rather than opening a menu —
   * the unsandboxed-run count stepping to the next such run (#1160). Ignored when {@link menu} is set.
   */
  readonly activate?: () => void;
}

/**
 * Describes the menu a status-strip segment opens: its rows, and what choosing one does.
 */
export interface StatusSegmentMenu {
  /**
   * Gets the rows.
   */
  readonly items: readonly MenuItem[];

  /**
   * Runs the chosen row.
   * @param id The chosen row's identifier.
   */
  readonly choose: (id: string) => void;
}
