import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Represents a vertical lane within a ribbon group, stacking its projected controls so that
 * different control types (large buttons, stacked small buttons, checks, fields) can sit
 * side by side within a single group.
 */
@Component({
  selector: 'app-ribbon-strip-column',
  imports: [],
  templateUrl: './ribbon-strip-column.html',
  styleUrl: './ribbon-strip-column.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripColumn {}
