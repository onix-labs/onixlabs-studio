import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Represents a horizontal lane within a ribbon group, laying its projected controls out in a row.
 * Paired with a {@link RibbonStripColumn}, it lets a group stack rows of controls (for example a field
 * above a row of small buttons) within the group's fixed height.
 */
@Component({
  selector: 'app-ribbon-strip-row',
  imports: [],
  templateUrl: './ribbon-strip-row.html',
  styleUrl: './ribbon-strip-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripRow {}
