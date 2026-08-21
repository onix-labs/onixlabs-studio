import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { StatusStripSegment } from '../status-strip-segment/status-strip-segment';

/**
 * Renders one contributor's status segments: a start-aligned group, a spacer, and an end-aligned
 * group. The host is laid out as `display: contents`, so the groups become direct flex children of
 * the status strip and the spacer pushes everything after it — the trailing segments, and the strip's
 * own ambient segments and menus — to the end of the bar.
 *
 * This is the one place status segments are styled. A feature's status component composes it with its
 * own leading and trailing signals rather than emitting spans of its own.
 */
@Component({
  selector: 'app-status-strip-segments',
  imports: [StatusStripSegment],
  templateUrl: './status-strip-segments.html',
  styleUrl: './status-strip-segments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripSegments {
  /**
   * Gets the start-aligned segments.
   */
  public readonly leading: InputSignal<readonly StatusSegment[]> = input<readonly StatusSegment[]>(
    [],
  );

  /**
   * Gets the end-aligned segments.
   */
  public readonly trailing: InputSignal<readonly StatusSegment[]> = input<readonly StatusSegment[]>(
    [],
  );
}
