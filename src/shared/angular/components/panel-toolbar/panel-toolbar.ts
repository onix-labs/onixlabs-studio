import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The shared tool-strip a docked panel draws at the top of its body (Logs, Error List, Terminal, a
 * document in the well — the dock draws none of its own, #882). It is the generic counterpart to the Solution Explorer's toolbar: a seamless row
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
