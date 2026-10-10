import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { formatAddress } from '@shared/angular/components/binary-editor/binary-editor';
import { formatFileSize } from '@shared/angular/services/formatting/file-size';
import { BinaryContext, BinaryStatus } from './binary-status';

/**
 * Formats a count with the reader's digit grouping.
 */
const COUNT: Intl.NumberFormat = new Intl.NumberFormat();

/**
 * Describes a file's size: the friendly size, then the exact count it rounds — "2.2 MB (2,271,456
 * bytes)" — or only the count while it is under a kilobyte, where the two would say the same thing.
 * @param bytes The size in bytes.
 * @returns Returns the size label.
 */
function describeSize(bytes: number): string {
  const exact: string = bytes === 1 ? '1 byte' : `${COUNT.format(bytes)} bytes`;
  return bytes < 1024 ? exact : `${formatFileSize(bytes)} (${exact})`;
}

/**
 * Shows the active binary view's status: its file path at the start of the strip, and at the end its
 * sniffed format, insert mode, cursor offset (written as the gutter writes it), the selection's length
 * while more than the caret's byte is selected, and the file's size (#882).
 *
 * Mounted by the status strip through the active binary view's injector, so it reads that view's own
 * {@link BinaryStatus}; it is destroyed when another tab is activated.
 */
@Component({
  selector: 'app-binary-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryStatusStrip {
  /**
   * Holds the owning view's editor context.
   */
  private readonly status: BinaryStatus = inject(BinaryStatus);

  /**
   * Gets the start-aligned segments: the document's path.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: BinaryContext | null = this.status.context();
      return context === null
        ? []
        : [
            {
              id: 'binary-path',
              text: context.dirty ? `${context.path} ●` : context.path,
              shrink: 'start',
            },
          ];
    },
  );

  /**
   * Gets the end-aligned segments: the sniffed format — first, so it is the last to drop out of a
   * narrow strip — then the insert mode, cursor offset, the selection's length (only for a selection
   * wider than the caret's own byte, which is always "selected") and the file size.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: BinaryContext | null = this.status.context();
      if (context === null) {
        return [];
      }
      const segments: StatusSegment[] = [
        { id: 'binary-format', text: context.format },
        { id: 'binary-mode', text: context.insertMode ? 'INS' : 'OVR' },
        {
          id: 'binary-offset',
          text: context.offset === null ? 'Offset —' : `Offset ${formatAddress(context.offset)}`,
        },
      ];
      if (context.selectionLength > 1) {
        segments.push({
          id: 'binary-selection',
          text: `${COUNT.format(context.selectionLength)} bytes selected`,
        });
      }
      segments.push({ id: 'binary-size', text: describeSize(context.size) });
      return segments;
    },
  );
}
