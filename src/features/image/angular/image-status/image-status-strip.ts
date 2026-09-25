import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { ImageContext, ImageStatus } from './image-status';

/**
 * Represents an image tab's status strip: the file and any editing note leading, and the format,
 * pixel dimensions, file size and zoom trailing.
 */
@Component({
  selector: 'app-image-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageStatusStrip {
  /**
   * Holds the viewing tab's status context.
   */
  private readonly status: ImageStatus = inject(ImageStatus);

  /**
   * Gets the leading segments: the path (marked when edited) and any editing note.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: ImageContext | null = this.status.context();
      if (context === null) {
        return [];
      }
      const segments: StatusSegment[] = [
        { id: 'image-path', text: context.dirty ? `${context.path} ●` : context.path },
      ];
      if (context.note !== null) {
        segments.push({ id: 'image-note', text: context.note });
      }
      return segments;
    },
  );

  /**
   * Gets the trailing segments: format, dimensions, file size and zoom.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: ImageContext | null = this.status.context();
      if (context === null) {
        return [];
      }
      const segments: StatusSegment[] = [{ id: 'image-format', text: context.format }];
      if (context.dimensions !== null) {
        segments.push({ id: 'image-dimensions', text: context.dimensions });
      }
      if (context.fileSize !== null) {
        segments.push({ id: 'image-size', text: context.fileSize });
      }
      segments.push({ id: 'image-zoom', text: context.zoom });
      return segments;
    },
  );
}
