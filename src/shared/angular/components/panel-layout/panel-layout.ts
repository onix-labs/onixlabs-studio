import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Represents the shared panel layout: a central main area surrounded by edge-docked {@link Panel}s
 * (one per top/right/bottom/left edge). Left and right panels span the full height; top and bottom
 * panels fit between them. Each panel resizes and collapses independently.
 *
 * This is the lightweight layout that single-surface feature views compose (an editor or terminal
 * in the centre, with terminal/agent/tool panels on the edges). It is deliberately *not* the dock:
 * there are no tab groups, no drag-to-rearrange, and no floating — a panel's edge is fixed by the
 * view, not by the user.
 *
 * The layout is a pure CSS-grid shell: the main content is projected into the centre and each
 * `<app-panel>` positions itself into its edge's grid area, so the container holds no layout logic.
 */
@Component({
  selector: 'app-panel-layout',
  templateUrl: './panel-layout.html',
  styleUrl: './panel-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelLayout {}
