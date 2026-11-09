import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import type { MenuItem } from '@shared/angular/components/menu/menu';
import {
  SET_BY_EDITOR_CONFIG,
  type DocumentStatusActions,
} from '@shared/angular/services/document-status/document-status';
import {
  chooseEncoding,
  chooseEol,
  encodingMenuItems,
  eolMenuItems,
} from '@shared/angular/services/document-status/document-status-menus';
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
      return context === null
        ? []
        : [{ id: 'code-path', text: context.path ?? 'New Document', shrink: 'start' }];
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
            ...this.indentSegment(context),
            this.eolSegment(context),
            this.encodingSegment(context),
          ];
    },
  );

  /**
   * Builds the indentation segment, once the editor has reported it.
   * @param context The document's status.
   * @returns Returns the segment, or none.
   */
  private indentSegment(context: CodeContext): readonly StatusSegment[] {
    const indent: string | undefined = context.indent;
    return indent === undefined || indent === ''
      ? []
      : [
          {
            id: 'code-indent',
            text: indent,
            ...(context.editorConfig?.includes('indent') === true
              ? { title: SET_BY_EDITOR_CONFIG }
              : {}),
          },
        ];
  }

  /**
   * Builds the end-of-line segment: a menu converting the line endings when the document can.
   * @param context The document's status.
   * @returns Returns the segment.
   */
  private eolSegment(context: CodeContext): StatusSegment {
    const actions: DocumentStatusActions | undefined = context.actions;
    return {
      id: 'code-eol',
      text: context.eol,
      ...(context.editorConfig?.includes('eol') === true ? { title: SET_BY_EDITOR_CONFIG } : {}),
      ...(actions?.setEol === undefined
        ? {}
        : {
            title: 'Select end of line sequence',
            menu: {
              items: eolMenuItems(context.eol),
              choose: (id: string): void => chooseEol(id, actions),
            },
          }),
    };
  }

  /**
   * Builds the encoding segment: a menu reopening or saving in another encoding when the document can.
   * @param context The document's status.
   * @returns Returns the segment.
   */
  private encodingSegment(context: CodeContext): StatusSegment {
    const items: readonly MenuItem[] = encodingMenuItems(context.actions);
    return {
      id: 'code-encoding',
      text: context.encoding,
      ...(context.editorConfig?.includes('encoding') === true
        ? { title: SET_BY_EDITOR_CONFIG }
        : {}),
      ...(items.length === 0
        ? {}
        : {
            title: 'Select encoding',
            menu: {
              items,
              choose: (id: string): void => chooseEncoding(id, context.actions),
            },
          }),
    };
  }
}
