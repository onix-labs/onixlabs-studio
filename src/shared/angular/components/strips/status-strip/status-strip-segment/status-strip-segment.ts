import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';

/**
 * Renders one status-strip segment: its optional icon, its text, and its hover title. This is the one
 * place a segment is styled — the view region's {@link StatusStripSegments} and the strip's own
 * ambient region both compose it, so a feature never emits status markup of its own.
 */
@Component({
  selector: 'app-status-strip-segment',
  imports: [AppIcon],
  template: `
    <span class="status-strip-segment" [title]="segment().title ?? segment().text">
      @if (segment().icon; as icon) {
        <app-icon [icon]="icon" />
      }
      {{ segment().text }}
    </span>
  `,
  styleUrl: './status-strip-segment.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripSegment {
  /**
   * Gets the segment to render.
   */
  public readonly segment: InputSignal<StatusSegment> = input.required<StatusSegment>();
}
