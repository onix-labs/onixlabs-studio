import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { BinaryContext, BinaryStatus } from './binary-status';

/**
 * Formats a byte offset as an upper-case, `0x`-prefixed hex string.
 * @param offset The byte offset.
 * @returns Returns the formatted offset.
 */
function hex(offset: number): string {
  return `0x${offset.toString(16).toUpperCase()}`;
}

/**
 * Shows the active binary view's status: its file path and sniffed format at the start of the strip,
 * and its insert mode, cursor offset, selection length and file size at the end.
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
   * Gets the start-aligned segments: the document's path and sniffed container format.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: BinaryContext | null = this.status.context();
      return context === null
        ? []
        : [
            { id: 'binary-path', text: context.dirty ? `${context.path} ●` : context.path },
            { id: 'binary-format', text: context.format },
          ];
    },
  );

  /**
   * Gets the end-aligned segments: the insert mode, cursor offset, selection length and file size.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: BinaryContext | null = this.status.context();
      return context === null
        ? []
        : [
            { id: 'binary-mode', text: context.insertMode ? 'INS' : 'OVR' },
            {
              id: 'binary-offset',
              text: context.offset === null ? 'Offset —' : `Offset ${hex(context.offset)}`,
            },
            { id: 'binary-selection', text: `Sel ${context.selectionLength}` },
            { id: 'binary-size', text: `${context.size} bytes` },
          ];
    },
  );
}
