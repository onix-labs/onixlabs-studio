import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { CodeContext, CodeStatus } from './code-status';

/**
 * Shows the active code view's status: its file path ("New Document" when unsaved) at the start of
 * the strip, and its cursor position, line-ending and encoding at the end.
 *
 * Mounted by the status strip through the active code view's injector, so it reads that view's own
 * {@link CodeStatus}; it is destroyed when another tab is activated, which is what keeps the strip
 * honest without any clearing on the view's part.
 */
@Component({
  selector: 'app-code-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeStatusStrip {
  /**
   * Holds the owning view's editor context.
   */
  private readonly status: CodeStatus = inject(CodeStatus);

  /**
   * Gets the start-aligned segments: the document's path.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: CodeContext | null = this.status.context();
      return context === null ? [] : [{ id: 'code-path', text: context.path ?? 'New Document' }];
    },
  );

  /**
   * Gets the end-aligned segments: the cursor position, line-ending and encoding.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: CodeContext | null = this.status.context();
      return context === null
        ? []
        : [
            { id: 'code-line', text: `Ln ${context.line}` },
            { id: 'code-col', text: `Col ${context.column}` },
            { id: 'code-eol', text: context.eol },
            { id: 'code-encoding', text: context.encoding },
          ];
    },
  );
}
