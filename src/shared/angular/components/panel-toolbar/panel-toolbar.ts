import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The shared tool-strip for docked tool panels (Output, Error List, Terminal — panels with
 * `ownsToolStrip`). It is the generic counterpart to the Solution Explorer's toolbar: a seamless row
 * that shows the panel's own background (no fill, no border) so the strip reads as part of the panel
 * frame rather than a separate bar. Consumers project their controls — an {@link
 * import('../forms/dropdown/dropdown').Dropdown}, tool-strip buttons (the global `.panel-toolbar__button`
 * class), a `.panel-toolbar__spacer` — into it.
 */
@Component({
  selector: 'app-panel-toolbar',
  template: '<ng-content />',
  styleUrl: './panel-toolbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelToolbar {}
