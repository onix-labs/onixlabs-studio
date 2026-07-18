import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The shared status strip for docked tool panels: a thin, seamless row along a panel's bottom edge
 * (no fill, no border, so it shows the panel's own background) carrying muted status items such as a
 * terminal's shell and working directory. Consumers project `.panel-status__item` spans into it.
 */
@Component({
  selector: 'app-panel-status',
  template: '<ng-content />',
  styleUrl: './panel-status.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelStatus {}
