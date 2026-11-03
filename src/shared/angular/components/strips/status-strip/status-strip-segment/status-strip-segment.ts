import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu } from '@shared/angular/components/menu/menu';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';

/**
 * Renders one status-strip segment: its optional icon, its text, and its hover title — and, when it
 * has one, the menu it opens (#1236). This is the one place a segment is styled — the view region's
 * {@link StatusStripSegments} and the strip's own ambient region both compose it, so a feature never
 * emits status markup of its own.
 */
@Component({
  selector: 'app-status-strip-segment',
  imports: [AppIcon, CdkMenuTrigger, Menu, NgTemplateOutlet],
  template: `
    <ng-template #content>
      @if (segment().icon; as icon) {
        <app-icon [icon]="icon" />
      }
      <span
        class="status-strip-segment__text"
        [class.status-strip-segment__text--from-start]="segment().shrink === 'start'"
        ><span class="status-strip-segment__run">{{ segment().text }}</span></span
      >
    </ng-template>
    @if (segment().menu; as menu) {
      <!-- A segment with a menu is a button that opens it, above the strip. -->
      <button
        type="button"
        class="status-strip-segment status-strip-segment--button"
        [title]="segment().title ?? segment().text"
        [attr.data-segment]="segment().id"
        [cdkMenuTriggerFor]="segmentMenu.panel() ?? null"
        [cdkMenuPosition]="segmentMenu.position()"
      >
        <ng-container [ngTemplateOutlet]="content" />
      </button>
      <app-menu
        #segmentMenu
        [items]="menu.items"
        placement="up-end"
        (selected)="menu.choose($event)"
      />
    } @else {
      <span class="status-strip-segment" [title]="segment().title ?? segment().text">
        <ng-container [ngTemplateOutlet]="content" />
      </span>
    }
  `,
  host: {
    '[class.status-strip-segment--shrink]': 'segment().shrink !== undefined',
  },
  styleUrl: './status-strip-segment.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripSegment {
  /**
   * Gets the segment to render.
   */
  public readonly segment: InputSignal<StatusSegment> = input.required<StatusSegment>();
}
